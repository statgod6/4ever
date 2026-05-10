import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { PlannerService } from './planner.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('planner')
@UseGuards(JwtAuthGuard)
export class PlannerController {
  constructor(private plannerService: PlannerService) {}

  @Get('dates/:year/:month')
  async getPlannedDates(
    @Param('year') year: string,
    @Param('month') month: string,
    @Request() req,
  ) {
    return this.plannerService.getPlannedDates(req.user.userId, +year, +month);
  }

  @Get('stats')
  async getCompletionStats(@Query('days') days: string, @Request() req) {
    return this.plannerService.getCompletionStats(req.user.userId, days ? +days : 7);
  }

  @Get(':date')
  async getPlan(@Param('date') date: string, @Request() req) {
    return this.plannerService.getPlan(req.user.userId, date);
  }

  @Put(':date')
  async savePlan(
    @Param('date') date: string,
    @Body('tasks') tasks: { timeSlot: string; task: string; sortOrder: number }[],
    @Request() req,
  ) {
    return this.plannerService.savePlan(req.user.userId, date, tasks);
  }

  @Post('insight/:taskId')
  async getTaskInsight(@Param('taskId') taskId: string, @Request() req) {
    return this.plannerService.getTaskInsight(req.user.userId, taskId);
  }

  @Patch('task/:taskId/status')
  async updateTaskStatus(
    @Param('taskId') taskId: string,
    @Body('status') status: 'done' | 'skipped' | 'pending',
    @Request() req,
  ) {
    return this.plannerService.updateTaskStatus(req.user.userId, taskId, status);
  }
}
