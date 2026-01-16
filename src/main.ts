import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  console.log('Static files path:', path.join(process.cwd(), 'dist', 'client'));
  const certsPath = path.join(__dirname, '..', 'certs');
  const keyPath = path.join(certsPath, 'key.pem');
  const certPath = path.join(certsPath, 'cert.pem');

  const forceHttp = process.env.FORCE_HTTP === 'true';
  const useHttps =
    !forceHttp && fs.existsSync(keyPath) && fs.existsSync(certPath);

  const httpsOptions = useHttps
    ? {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      }
    : undefined;

  const app = await NestFactory.create(AppModule, {
    ...(httpsOptions && { httpsOptions }),
  });
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');

  const protocol = useHttps ? 'https' : 'http';
  console.log(`Server running on ${protocol}://0.0.0.0:${port}`);
}
void bootstrap();
