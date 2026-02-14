import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    // Serve audio samples
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'dist', 'client', 'samples'),
      serveRoot: '/samples',
      serveStaticOptions: {
        index: false,
        maxAge: 31536000000, // 1 year in ms
      },
    }),
    // Serve main app
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'dist', 'client'),
      exclude: ['/api/**', '/samples/**'],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
