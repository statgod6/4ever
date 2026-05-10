import {
  Controller,
  Get,
  Put,
  Patch,
  Post,
  Delete,
  Body,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateUserContextDto } from './dto/update-user-context.dto';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const AVATAR_DIR = join(__dirname, '..', '..', 'uploads', 'avatars');

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req) {
    return this.usersService.findById(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/subscription')
  async getSubscription(@Request() req) {
    return this.usersService.getSubscription(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(@Request() req, @Body() body: { name?: string }) {
    return this.usersService.updateProfile(req.user.userId, { name: body.name });
  }

  @UseGuards(JwtAuthGuard)
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: AVATAR_DIR,
        filename: (req: any, file, cb) => {
          const userId = req?.user?.userId || 'user';
          const ext = extname(file.originalname || '').toLowerCase() || '.jpg';
          cb(null, `${userId}-${Date.now()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
          return cb(new BadRequestException('Only JPEG, PNG, and WebP images are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(@Request() req, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const avatarUrl = `/uploads/avatars/${file.filename}`;
    return this.usersService.setAvatarUrl(req.user.userId, avatarUrl);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('avatar')
  async deleteAvatar(@Request() req) {
    return this.usersService.clearAvatar(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('context')
  async getContext(@Request() req) {
    const context = await this.usersService.getContext(req.user.userId);
    return context || {};
  }

  @UseGuards(JwtAuthGuard)
  @Put('context')
  async updateContext(@Request() req, @Body() body: UpdateUserContextDto) {
    return this.usersService.upsertContext(req.user.userId, {
      name: body.name,
      age: body.age,
      location: body.location,
      role: body.role,
      background: body.background,
      currentProjects: body.currentProjects,
      goals: body.goals,
      situation: body.situation,
      values: body.values,
      pendingDecisions: body.pendingDecisions,
      freeformContext: body.freeformContext,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/relationship-health-opt-in')
  async setRelationshipHealthOptIn(
    @Request() req,
    @Body() body: { enabled: boolean },
  ) {
    return this.usersService.setRelationshipHealthOptIn(
      req.user.userId,
      !!body.enabled,
    );
  }
}
