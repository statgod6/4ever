import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RitualsService } from './rituals.service';
import { CreateRitualDto } from './dto/create-ritual.dto';

@Controller('rituals')
@UseGuards(JwtAuthGuard)
export class RitualsController {
  constructor(private readonly ritualsService: RitualsService) {}

  @Post()
  create(@Request() req, @Body() dto: CreateRitualDto) {
    return this.ritualsService.create(req.user.userId, dto);
  }

  @Get()
  findAll(@Request() req) {
    return this.ritualsService.findAll(req.user.userId);
  }

  @Post(':id/complete')
  complete(@Request() req, @Param('id') id: string) {
    return this.ritualsService.complete(req.user.userId, id);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.ritualsService.remove(req.user.userId, id);
  }
}
