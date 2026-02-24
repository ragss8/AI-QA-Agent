import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Entry point for the NestJS application.  The server listens on port 3000 by
 * default.  Adjust the port via the `PORT` environment variable if needed.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`\n🚀 Agentic AI QA backend listening on http://localhost:${port}\n`);
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap the application:', err);
});