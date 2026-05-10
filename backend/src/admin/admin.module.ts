import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminSecretGuard } from './admin-secret.guard';

@Module({
  imports: [UsersModule],
  controllers: [AdminController],
  providers: [AdminSecretGuard],
})
export class AdminModule {}
