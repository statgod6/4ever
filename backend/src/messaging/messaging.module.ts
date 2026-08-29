import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { OntologyModule } from '../ontology/ontology.module';
import { ConnectionsService } from './connections.service';
import { MessagingService } from './messaging.service';
import { SharedNotesService } from './shared-notes.service';
import { MediatorService } from './mediator.service';
import { MessagingGateway } from './messaging.gateway';
import { ConnectionsController } from './connections.controller';
import { MessagesController } from './messages.controller';
import { requireJwtSecret } from '../auth/jwt-secret';

@Module({
  imports: [
    PrismaModule,
    OntologyModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requireJwtSecret(config),
      }),
    }),
  ],
  controllers: [ConnectionsController, MessagesController],
  providers: [
    ConnectionsService,
    MessagingService,
    SharedNotesService,
    MediatorService,
    MessagingGateway,
  ],
  exports: [ConnectionsService, MessagingService, SharedNotesService, MediatorService],
})
export class MessagingModule {}
