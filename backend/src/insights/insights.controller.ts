import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { InsightsService } from './insights.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('insights')
@UseGuards(JwtAuthGuard)
export class InsightsController {
  constructor(private insightsService: InsightsService) {}

  @Get('stats')
  async getStats(@Request() req) {
    return this.insightsService.getStats(req.user.userId);
  }

  @Get('recurring-topics')
  async getRecurringTopics(@Request() req) {
    return this.insightsService.getRecurringTopics(req.user.userId);
  }

  @Post('evolution')
  async generateEvolution(
    @Body('thoughtIds') thoughtIds: string[],
    @Request() req,
  ) {
    return this.insightsService.generateEvolutionAnalysis(req.user.userId, thoughtIds);
  }

  @Post('weekly')
  async generateWeeklyInsight(@Request() req) {
    return this.insightsService.generateWeeklyInsight(req.user.userId);
  }

  @Get('reports')
  async getReports(@Request() req) {
    return this.insightsService.getReports(req.user.userId);
  }

  @Get('life-dimensions')
  async getLifeDimensions(@Request() req) {
    return this.insightsService.getLifeDimensions(req.user.userId);
  }

  @Get('relationship-health')
  async getRelationshipHealth(
    @Request() req,
    @Query('connectionId') connectionId?: string,
    @Query('days') days?: string,
  ) {
    return this.insightsService.getRelationshipHealth(req.user.userId, {
      connectionId,
      days: days ? parseInt(days, 10) : undefined,
    });
  }
}
