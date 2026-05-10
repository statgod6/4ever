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
  Response,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UnauthorizedException,
  Header,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { UsersService } from './users.service';
import { UsersDataService } from './users-data.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateUserContextDto } from './dto/update-user-context.dto';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const AVATAR_DIR = join(__dirname, '..', '..', 'uploads', 'avatars');

@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private usersData: UsersDataService,
    private authService: AuthService,
  ) {}

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
          // Use an unguessable UUID instead of the user id. Embedding the user
          // id in a publicly-fetchable URL enables user-enumeration attacks
          // and leaks ownership via CDN logs / referer headers.
          // TODO(P5-storage): replace with HMAC-signed short-lived URLs when
          // avatars migrate to S3/R2 object storage.
          const ext = extname(file.originalname || '').toLowerCase() || '.jpg';
          cb(null, `${randomUUID()}${ext}`);
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

  // =========================================================================
  // GDPR / App Store compliance endpoints (P3)
  //
  // Apple Guideline 5.1.1(v) + Google Play Data Safety both require that
  // users can delete their account entirely from within the app, and GDPR
  // Art. 15 / 20 require data portability. These routes expose that path.
  // =========================================================================

  /**
   * GET /api/users/me/export
   * Returns the full user data dump as a JSON download.
   * Heavily throttled — large response + touches every user-owned table.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60 * 60_000, limit: 5 } }) // 5/hour
  @Get('me/export')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="4ever-data-export.json"')
  async exportMyData(@Request() req) {
    return this.usersData.exportAll(req.user.userId);
  }

  /**
   * DELETE /api/users/me
   * Permanently deletes the account and all owned data.
   *
   * Requires OTP re-verification to prevent hijacked-session wipeouts: the
   * client first calls POST /api/auth/request-otp with the user's phone,
   * then passes the received code here as { otpCode }. In non-production
   * environments the OTP check is skipped when `confirm: "DELETE MY ACCOUNT"`
   * is supplied, to keep integration tests ergonomic.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60 * 60_000, limit: 3 } }) // 3/hour
  @Delete('me')
  async deleteMyAccount(
    @Request() req,
    @Body() body: { otpCode?: string; confirm?: string },
  ) {
    const userId: string = req.user.userId;
    const phone: string | undefined = req.user.phone;

    const devBypass =
      process.env.NODE_ENV !== 'production' &&
      body?.confirm === 'DELETE MY ACCOUNT';

    if (!devBypass) {
      if (!body?.otpCode || !phone) {
        throw new UnauthorizedException(
          'Account deletion requires OTP re-verification. Request a code via /api/auth/request-otp then pass it as { otpCode }.',
        );
      }
      await this.authService.verifyOtpForAction(phone, body.otpCode);
    }

    return this.usersData.deleteAccount(userId);
  }
}
