import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePersonaDto } from './dto/create-persona.dto';
import { UpdatePersonaDto } from './dto/update-persona.dto';

@Injectable()
export class PersonasService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, createPersonaDto: CreatePersonaDto) {
    return this.prisma.persona.create({
      data: {
        userId,
        name: createPersonaDto.name,
        description: createPersonaDto.description,
        systemPrompt: createPersonaDto.systemPrompt,
        modelName: createPersonaDto.modelName || 'deepseek/deepseek-v3.2',
        category: createPersonaDto.category,
        isTemplate: false,
        isActive: true,
      },
    });
  }

  // Return user's own personas + all templates, unified in a single list.
  async findAll(userId: string) {
    return this.prisma.persona.findMany({
      where: {
        OR: [{ userId }, { isTemplate: true }],
      },
      orderBy: [
        { isTemplate: 'asc' }, // user-owned first, then templates
        { createdAt: 'desc' },
      ],
    });
  }

  async findActive(userId: string) {
    return this.prisma.persona.findMany({
      where: {
        isActive: true,
        OR: [{ userId }, { isTemplate: true }],
      },
      orderBy: [{ isTemplate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(userId: string, id: string) {
    const persona = await this.prisma.persona.findFirst({
      where: {
        id,
        OR: [{ userId }, { isTemplate: true }],
      },
    });

    if (!persona) {
      throw new NotFoundException('Persona not found');
    }

    return persona;
  }

  async update(userId: string, id: string, updatePersonaDto: UpdatePersonaDto) {
    const persona = await this.prisma.persona.findFirst({ where: { id } });

    if (!persona) {
      throw new NotFoundException('Persona not found');
    }

    if (persona.isTemplate || persona.userId !== userId) {
      throw new ForbiddenException('Library personas cannot be edited. Create your own copy instead.');
    }

    return this.prisma.persona.update({
      where: { id },
      data: {
        name: updatePersonaDto.name,
        description: updatePersonaDto.description,
        systemPrompt: updatePersonaDto.systemPrompt,
        modelName: updatePersonaDto.modelName,
        category: updatePersonaDto.category,
        isActive: updatePersonaDto.isActive,
      },
    });
  }

  async remove(userId: string, id: string) {
    const persona = await this.prisma.persona.findFirst({ where: { id } });

    if (!persona) {
      throw new NotFoundException('Persona not found');
    }

    if (persona.isTemplate || persona.userId !== userId) {
      throw new ForbiddenException('Library personas cannot be deleted.');
    }

    // Soft delete by deactivating
    return this.prisma.persona.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
