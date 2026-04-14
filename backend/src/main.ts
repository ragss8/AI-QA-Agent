import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Entry point for the NestJS application. The server listens on port 3000 by
 * default. Adjust the port via the `PORT` environment variable if needed.
 */
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);

  logger.log(`Agentic AI QA backend listening on http://localhost:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap the application:', error);
});
