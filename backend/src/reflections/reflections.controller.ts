import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReflectionsService } from './reflections.service';

@Controller('reflections')
@UseGuards(JwtAuthGuard)
export class ReflectionsController {
  constructor(private reflectionsService: ReflectionsService) {}

  @Get('evening')
  getEveningReflection(@Request() req: any) {
    return this.reflectionsService.generateEveningReflection(req.user.userId);
  }

  @Get('weekly')
  getWeeklyReflection(@Request() req: any) {
    return this.reflectionsService.generateWeeklyReflection(req.user.userId);
  }
}
