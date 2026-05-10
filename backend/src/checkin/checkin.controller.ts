import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CheckInService } from './checkin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SaveCheckInDto } from './dto/save-checkin.dto';

@Controller('checkin')
@UseGuards(JwtAuthGuard)
export class CheckInController {
  constructor(private checkInService: CheckInService) {}

  @Get('recent')
  async getRecentCheckIns(@Query('days') days: string, @Request() req) {
    return this.checkInService.getRecentCheckIns(
      req.user.userId,
      days ? +days : 14,
    );
  }

  @Get(':date')
  async getCheckIn(@Param('date') date: string, @Request() req) {
    return this.checkInService.getCheckIn(req.user.userId, date);
  }

  @Put(':date')
  async saveCheckIn(
    @Param('date') date: string,
    @Body() dto: SaveCheckInDto,
    @Request() req,
  ) {
    return this.checkInService.saveCheckIn(
      req.user.userId,
      date,
      dto.mood,
      dto.energy,
      dto.note,
    );
  }
}
