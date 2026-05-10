import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RelationshipsService } from './relationships.service';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { UpdateRelationshipDto } from './dto/update-relationship.dto';
import { AddRelationshipNoteDto } from './dto/add-relationship-note.dto';

@Controller('relationships')
@UseGuards(JwtAuthGuard)
export class RelationshipsController {
  constructor(private readonly relationshipsService: RelationshipsService) {}

  @Post()
  create(@Request() req, @Body() dto: CreateRelationshipDto) {
    return this.relationshipsService.create(req.user.userId, dto);
  }

  @Get()
  findAll(@Request() req) {
    return this.relationshipsService.findAll(req.user.userId);
  }

  @Get('health')
  getHealth(@Request() req) {
    return this.relationshipsService.getHealth(req.user.userId);
  }

  @Get('annual-review')
  getAnnualReview(@Request() req) {
    return this.relationshipsService.getAnnualReview(req.user.userId);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.relationshipsService.findOne(req.user.userId, id);
  }

  @Put(':id')
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateRelationshipDto) {
    return this.relationshipsService.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.relationshipsService.remove(req.user.userId, id);
  }

  @Post(':id/notes')
  addNote(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: AddRelationshipNoteDto,
  ) {
    return this.relationshipsService.addNote(
      req.user.userId,
      id,
      dto.content,
      'manual',
      dto.sentiment,
      dto.topic,
    );
  }

  @Post(':id/create-persona')
  createPersona(@Request() req, @Param('id') id: string) {
    return this.relationshipsService.createPersonaFromPerson(req.user.userId, id);
  }

  @Post(':id/link-user')
  linkUser(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { linkedUserId: string | null },
  ) {
    return this.relationshipsService.linkUser(
      req.user.userId,
      id,
      body?.linkedUserId ?? null,
    );
  }
}
