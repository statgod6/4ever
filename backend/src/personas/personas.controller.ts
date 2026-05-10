import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { PersonasService } from './personas.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePersonaDto } from './dto/create-persona.dto';
import { UpdatePersonaDto } from './dto/update-persona.dto';

@Controller('personas')
@UseGuards(JwtAuthGuard)
export class PersonasController {
  constructor(private personasService: PersonasService) {}

  @Post()
  async create(@Body() createPersonaDto: CreatePersonaDto, @Request() req) {
    return this.personasService.create(req.user.userId, createPersonaDto);
  }

  @Get()
  async findAll(@Request() req) {
    return this.personasService.findAll(req.user.userId);
  }

  @Get('active')
  async findActive(@Request() req) {
    return this.personasService.findActive(req.user.userId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    return this.personasService.findOne(req.user.userId, id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updatePersonaDto: UpdatePersonaDto,
    @Request() req,
  ) {
    return this.personasService.update(req.user.userId, id, updatePersonaDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req) {
    return this.personasService.remove(req.user.userId, id);
  }
}
