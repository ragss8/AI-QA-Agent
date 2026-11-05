export interface EvalCase {
  id: string;
  prdText: string;
  baseUrl: string;
  fixture: string;
  /** Pages the model may have memorised flatter its score. */
  memorised: boolean;
}

/**
 * Five frozen cases. Page markup is cached under fixtures/ so a run is fast and
 * does not depend on the live internet.
 *
 * `synthetic-crate-intake` is the control: it is a page that exists nowhere, so
 * a model cannot recall its selectors and has to read the HTML it was given.
 * Compare its score against the others to separate reasoning from recall.
 */
export const CASES: EvalCase[] = [
  {
    id: 'login',
    prdText: 'User should be able to login with valid and invalid credentials',
    baseUrl: 'https://the-internet.herokuapp.com/login',
    fixture: 'login.html',
    memorised: true,
  },
  {
    id: 'checkboxes',
    prdText:
      'User should be able to toggle each checkbox on the page independently, and the page should reflect the checked state',
    baseUrl: 'https://the-internet.herokuapp.com/checkboxes',
    fixture: 'checkboxes.html',
    memorised: true,
  },
  {
    id: 'dropdown',
    prdText:
      'User should be able to select any option from the dropdown, and selecting an option should update the current selection',
    baseUrl: 'https://the-internet.herokuapp.com/dropdown',
    fixture: 'dropdown.html',
    memorised: true,
  },
  {
    id: 'forgot-password',
    prdText:
      'User should be able to request a password reset by submitting their email address, and should be prevented from submitting an empty one',
    baseUrl: 'https://the-internet.herokuapp.com/forgot_password',
    fixture: 'forgot-password.html',
    memorised: true,
  },
  {
    id: 'synthetic-crate-intake',
    prdText:
      'Depot staff should be able to log a crate intake by entering a consignment reference and pallet count, choosing a bonded depot, optionally marking the consignment perishable, and submitting the form. Submitting without a consignment reference or with a pallet count above 48 should be rejected.',
    baseUrl: 'https://example.invalid/intake',
    fixture: 'synthetic-crate-intake.html',
    memorised: false,
  },
  {
    id: 'whitegold-signin',
    prdText:
      'An employee should be able to begin signing in to the CRM by entering their Employee ID and continuing. Submitting an empty Employee ID should be rejected, and the Google sign-in route should be available as an alternative.',
    baseUrl: 'https://testing.whitegold.online/',
    fixture: 'whitegold-signin.html',
    memorised: false,
  },
];
