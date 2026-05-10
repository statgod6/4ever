import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ThoughtsService } from './thoughts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateThoughtDto } from './dto/create-thought.dto';
import { UpdateThoughtDto } from './dto/update-thought.dto';

@Controller('thoughts')
@UseGuards(JwtAuthGuard)
export class ThoughtsController {
  constructor(private thoughtsService: ThoughtsService) {}

  @Post()
  async create(@Body() createThoughtDto: CreateThoughtDto, @Request() req) {
    return this.thoughtsService.create(req.user.userId, createThoughtDto);
  }

  @Get()
  async findAll(
    @Request() req,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.thoughtsService.findAll(
      req.user.userId,
      take ? +take : undefined,
      skip ? +skip : undefined,
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    return this.thoughtsService.findOne(req.user.userId, id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateThoughtDto: UpdateThoughtDto,
    @Request() req,
  ) {
    return this.thoughtsService.update(req.user.userId, id, updateThoughtDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req) {
    return this.thoughtsService.remove(req.user.userId, id);
  }

  @Post(':threadId/continue')
  async continueThread(
    @Param('threadId') threadId: string,
    @Body('content') content: string,
    @Request() req,
  ) {
    return this.thoughtsService.continueThread(req.user.userId, threadId, content);
  }
}
