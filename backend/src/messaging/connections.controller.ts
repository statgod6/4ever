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
import { ConnectionsService } from './connections.service';
import { SharedNotesService } from './shared-notes.service';
import { SendRequestDto } from './dto/send-request.dto';
import { SendInviteDto } from './dto/send-invite.dto';
import { AddSharedNoteDto } from './dto/add-shared-note.dto';

@Controller('connections')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly sharedNotesService: SharedNotesService,
  ) {}

  @Get('search')
  searchUsers(@Request() req, @Query('q') query: string) {
    return this.connectionsService.searchUsers(query, req.user.userId);
  }

  @Get()
  getConnections(@Request() req) {
    return this.connectionsService.getConnections(req.user.userId);
  }

  @Get('pending')
  getPendingRequests(@Request() req) {
    return this.connectionsService.getPendingRequests(req.user.userId);
  }

  @Post('discover')
  discoverContacts(@Request() req, @Body() body: { phoneNumbers: string[] }) {
    return this.connectionsService.discoverContacts(req.user.userId, body.phoneNumbers);
  }

  @Post('resolve-phone')
  resolvePhone(@Request() req, @Body() body: { phoneNumber: string }) {
    return this.connectionsService.resolvePhone(req.user.userId, body?.phoneNumber ?? '');
  }

  @Post('request')
  sendRequest(@Request() req, @Body() dto: SendRequestDto) {
    return this.connectionsService.sendRequest(req.user.userId, dto.receiverId);
  }

  @Post('invite')
  sendInvite(@Request() req, @Body() dto: SendInviteDto) {
    return this.connectionsService.sendInviteByPhone(req.user.userId, dto.phoneNumber);
  }

  @Post(':id/accept')
  acceptRequest(@Request() req, @Param('id') id: string) {
    return this.connectionsService.acceptRequest(req.user.userId, id);
  }

  @Post(':id/reject')
  rejectRequest(@Request() req, @Param('id') id: string) {
    return this.connectionsService.rejectRequest(req.user.userId, id);
  }

  @Delete(':id')
  removeConnection(@Request() req, @Param('id') id: string) {
    return this.connectionsService.removeConnection(req.user.userId, id);
  }

  // ---- Shared Notes ----

  @Get(':id/notes')
  getNotes(
    @Request() req,
    @Param('id') connectionId: string,
    @Query('type') noteType?: string,
  ) {
    return this.sharedNotesService.getNotes(req.user.userId, connectionId, noteType);
  }

  @Post(':id/notes')
  addNote(
    @Request() req,
    @Param('id') connectionId: string,
    @Body() dto: AddSharedNoteDto,
  ) {
    return this.sharedNotesService.addNote(
      req.user.userId,
      connectionId,
      dto.content,
      dto.noteType,
    );
  }

  @Delete('notes/:noteId')
  deleteNote(@Request() req, @Param('noteId') noteId: string) {
    return this.sharedNotesService.deleteNote(req.user.userId, noteId);
  }

  // ---- Shared Relationship View ----

  @Get(':id/shared')
  getSharedRelationship(@Request() req, @Param('id') connectionId: string) {
    return this.sharedNotesService.getSharedRelationship(req.user.userId, connectionId);
  }
}
