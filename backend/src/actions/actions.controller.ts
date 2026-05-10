import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ActionsService } from './actions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LinkToPlannerDto } from './dto/link-to-planner.dto';

@Controller('actions')
@UseGuards(JwtAuthGuard)
export class ActionsController {
  constructor(private actionsService: ActionsService) {}

  @Get()
  async getActionItems(
    @Query('status') status: string,
    @Request() req,
  ) {
    return this.actionsService.getActionItems(req.user.userId, status || undefined);
  }

  @Patch(':id/status')
  async updateActionStatus(
    @Param('id') id: string,
    @Body('status') status: 'done' | 'dismissed',
    @Request() req,
  ) {
    return this.actionsService.updateActionStatus(req.user.userId, id, status);
  }

  @Post(':id/to-planner')
  async linkToPlanner(
    @Param('id') id: string,
    @Body() dto: LinkToPlannerDto,
    @Request() req,
  ) {
    return this.actionsService.linkToPlanner(
      req.user.userId,
      id,
      dto.date,
      dto.timeSlot,
    );
  }
}
