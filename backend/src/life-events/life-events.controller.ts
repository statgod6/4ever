import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LifeEventsService } from './life-events.service';
import { CreateLifeEventDto } from './dto/create-life-event.dto';

@Controller('life-events')
@UseGuards(JwtAuthGuard)
export class LifeEventsController {
  constructor(private readonly lifeEventsService: LifeEventsService) {}

  @Post()
  create(@Request() req, @Body() dto: CreateLifeEventDto) {
    return this.lifeEventsService.create(req.user.userId, dto);
  }

  @Get()
  findAll(@Request() req) {
    return this.lifeEventsService.findAll(req.user.userId);
  }

  @Get('upcoming')
  findUpcoming(@Request() req, @Query('days') days?: string) {
    return this.lifeEventsService.findUpcoming(req.user.userId, days ? parseInt(days, 10) : 30);
  }

  @Get('person/:personId')
  findByPerson(@Request() req, @Param('personId') personId: string) {
    return this.lifeEventsService.findByPerson(req.user.userId, personId);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.lifeEventsService.remove(req.user.userId, id);
  }
}
