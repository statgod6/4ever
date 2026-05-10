import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsersDataService } from './users-data.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [UsersService, UsersDataService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
