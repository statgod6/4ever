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
import { TensionsService } from './tensions.service';
import { CreateTensionDto } from './dto/create-tension.dto';
import { StartCoolDownDto } from './dto/start-cool-down.dto';
import { ResolveTensionDto } from './dto/resolve-tension.dto';

@Controller('tensions')
@UseGuards(JwtAuthGuard)
export class TensionsController {
  constructor(private readonly tensionsService: TensionsService) {}

  @Post()
  create(@Request() req, @Body() dto: CreateTensionDto) {
    return this.tensionsService.create(req.user.userId, dto);
  }

  @Get()
  findAll(@Request() req) {
    return this.tensionsService.findAll(req.user.userId);
  }

  @Post(':id/cool-down')
  startCoolDown(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: StartCoolDownDto,
  ) {
    return this.tensionsService.startCoolDown(req.user.userId, id, dto.minutes || 30);
  }

  @Post(':id/resolve')
  resolve(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: ResolveTensionDto,
  ) {
    return this.tensionsService.resolve(req.user.userId, id, dto.resolution);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.tensionsService.remove(req.user.userId, id);
  }
}
