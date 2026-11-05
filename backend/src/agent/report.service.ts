import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { RunStatusSnapshot, TestCaseResult } from './agent.types';

const OUTCOME_FILL: Record<string, string> = {
  PASSED: 'FFE3F2E9',
  FAILED: 'FFFBE6E2',
  SKIPPED: 'FFF2F2F2',
  PENDING: 'FFFBF0DA',
};

export interface ReportContext {
  runId: string;
  baseUrl: string;
  prdText: string;
  createdAt?: Date;
  snapshot: RunStatusSnapshot;
}

/**
 * Builds the downloadable test report.
 *
 * Four sheets rather than one table, because a tester handing this on needs the
 * summary separately from the detail, and needs to see what the agent invented
 * and which screens it actually observed — otherwise there is no way to judge
 * how much of the plan is grounded.
 */
@Injectable()
export class ReportService {
  async toXlsx(context: ReportContext): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AI QA Agent';
    workbook.created = context.createdAt ?? new Date();

    this.addSummary(workbook, context);
    this.addTestCases(workbook, context.snapshot.results ?? []);
    this.addDataUsed(workbook, context);
    this.addExploration(workbook, context);

    return (await workbook.xlsx.writeBuffer()) as Buffer;
  }

  private addSummary(workbook: ExcelJS.Workbook, context: ReportContext): void {
    const sheet = workbook.addWorksheet('Summary');
    const { snapshot } = context;
    const s = snapshot.summary;

    sheet.columns = [
      { key: 'k', width: 24 },
      { key: 'v', width: 96 },
    ];

    const rows: Array<[string, string]> = [
      ['Run ID', context.runId],
      ['Target URL', context.baseUrl],
      ['What was tested', context.prdText],
      ['Executed at', (context.createdAt ?? new Date()).toISOString()],
      ['Run status', snapshot.status],
      ['Engine', `${snapshot.provider ?? 'unknown'} (${snapshot.model ?? 'unknown'})`],
      ['', ''],
      ['Total cases', String(s?.total ?? 0)],
      ['Passed', String(s?.passed ?? 0)],
      ['Failed', String(s?.failed ?? 0)],
      ['Skipped / not run', String(s?.skipped ?? 0)],
      [
        'Pass rate',
        s && s.total > 0 ? `${Math.round((100 * s.passed) / s.total)}%` : 'n/a',
      ],
    ];

    sheet.addRow(['Test Execution Report']).font = { bold: true, size: 14 };
    sheet.addRow([]);
    for (const [k, v] of rows) {
      const row = sheet.addRow({ k, v });
      row.getCell('k').font = { bold: true };
      row.getCell('v').alignment = { wrapText: true, vertical: 'top' };
    }

    if (snapshot.advisories?.length) {
      sheet.addRow([]);
      sheet.addRow(['Before you trust these results']).font = { bold: true, size: 12 };
      for (const note of snapshot.advisories) {
        const row = sheet.addRow({ k: '', v: note });
        row.getCell('v').alignment = { wrapText: true, vertical: 'top' };
        row.getCell('v').font = { color: { argb: 'FF96620A' } };
      }
    }
  }

  private addTestCases(workbook: ExcelJS.Workbook, results: TestCaseResult[]): void {
    const sheet = workbook.addWorksheet('Test Cases');

    sheet.columns = [
      { header: 'TC ID', key: 'id', width: 10 },
      { header: 'Description', key: 'description', width: 46 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'Origin', key: 'source', width: 10 },
      { header: 'Preconditions', key: 'preconditions', width: 34 },
      { header: 'Steps', key: 'steps', width: 48 },
      { header: 'Expected result', key: 'expectedResult', width: 40 },
      { header: 'Status', key: 'outcome', width: 11 },
      { header: 'Reason', key: 'reason', width: 64 },
      { header: 'Duration (ms)', key: 'durationMs', width: 14 },
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: 'middle' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const result of results) {
      const row = sheet.addRow({
        ...result,
        steps: (result.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n'),
        preconditions: result.preconditions ?? '',
        expectedResult: result.expectedResult ?? '',
        priority: result.priority ?? '',
        durationMs: result.durationMs ?? '',
      });

      row.alignment = { wrapText: true, vertical: 'top' };
      const fill = OUTCOME_FILL[result.outcome];
      if (fill) {
        row.getCell('outcome').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fill },
        };
        row.getCell('outcome').font = { bold: true };
      }
    }

    sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };
  }

  private addDataUsed(workbook: ExcelJS.Workbook, context: ReportContext): void {
    const inputs = context.snapshot.syntheticInputs ?? [];
    const sheet = workbook.addWorksheet('Data Used');

    sheet.columns = [
      { header: 'Field', key: 'field', width: 30 },
      { header: 'Value used', key: 'value', width: 28 },
      { header: 'Must match real data?', key: 'needsRealValue', width: 22 },
      { header: 'Why this value', key: 'rationale', width: 76 },
    ];
    sheet.getRow(1).font = { bold: true };

    if (inputs.length === 0) {
      sheet.addRow({
        field: '(none)',
        value: '',
        needsRealValue: '',
        rationale: 'Every value came from the description; nothing was invented.',
      });
      return;
    }

    for (const input of inputs) {
      const row = sheet.addRow({
        ...input,
        needsRealValue: input.needsRealValue ? 'YES — likely rejected' : 'no',
      });
      row.alignment = { wrapText: true, vertical: 'top' };
      if (input.needsRealValue) {
        row.getCell('needsRealValue').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: OUTCOME_FILL.PENDING },
        };
      }
    }
  }

  private addExploration(workbook: ExcelJS.Workbook, context: ReportContext): void {
    const sheet = workbook.addWorksheet('Exploration');
    const exploration = context.snapshot.exploration;

    sheet.columns = [
      { key: 'k', width: 24 },
      { key: 'v', width: 96 },
    ];
    sheet.addRow(['How much of the app was actually seen']).font = {
      bold: true,
      size: 12,
    };
    sheet.addRow([]);

    const rows: Array<[string, string]> = [
      ['Screens observed', String(exploration?.stepsVisited ?? 0)],
      ['Reached the goal', exploration?.reachedGoal ? 'yes' : 'no'],
      ['Stopped because', exploration?.stoppedBecause ?? 'reached the goal'],
    ];

    for (const [k, v] of rows) {
      const row = sheet.addRow({ k, v });
      row.getCell('k').font = { bold: true };
      row.getCell('v').alignment = { wrapText: true, vertical: 'top' };
    }

    sheet.addRow([]);
    const caveat = exploration?.reachedGoal
      ? 'Cases are grounded in screens the agent observed directly.'
      : 'The agent did not reach the goal screen. Cases covering anything beyond the screens above are inferred from the description, and their selectors are unverified.';
    const row = sheet.addRow({ k: 'Note', v: caveat });
    row.getCell('k').font = { bold: true };
    row.getCell('v').alignment = { wrapText: true, vertical: 'top' };
  }
}
