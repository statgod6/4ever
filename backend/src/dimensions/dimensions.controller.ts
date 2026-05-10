import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DimensionsService } from './dimensions.service';
import { SelfRateDimensionDto } from './dto/self-rate-dimension.dto';
import { WeeklyCheckinDto } from './dto/weekly-checkin.dto';

@Controller('dimensions')
@UseGuards(JwtAuthGuard)
export class DimensionsController {
  constructor(private readonly service: DimensionsService) {}

  /** GET /api/dimensions — full life wheel (radar payload) */
  @Get()
  getLifeWheel(@Request() req) {
    return this.service.getLifeWheel(req.user.userId);
  }

  /** POST /api/dimensions/self-rate — one dimension at a time */
  @Post('self-rate')
  selfRate(@Request() req, @Body() dto: SelfRateDimensionDto) {
    return this.service.selfRate(
      req.user.userId,
      dto.dimension,
      dto.score,
      dto.note,
    );
  }

  /** POST /api/dimensions/weekly-checkin — six dimensions in one call */
  @Post('weekly-checkin')
  weeklyCheckin(@Request() req, @Body() dto: WeeklyCheckinDto) {
    return this.service.weeklyCheckin(req.user.userId, dto.ratings, dto.note);
  }

  /** GET /api/dimensions/:dim/history — 12-week trend */
  @Get(':dim/history')
  getHistory(@Request() req, @Param('dim') dim: string) {
    return this.service.getHistory(req.user.userId, dim);
  }

  /** GET /api/dimensions/:dim/detail — recent signals + latest self rating */
  @Get(':dim/detail')
  getDetail(@Request() req, @Param('dim') dim: string) {
    return this.service.getDetail(req.user.userId, dim);
  }
}
