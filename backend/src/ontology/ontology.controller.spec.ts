import { Test, TestingModule } from '@nestjs/testing';
import { OntologyController } from './ontology.controller';
import { OntologyService } from './ontology.service';
import { OntologySynthesisService } from './synthesis.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

describe('OntologyController', () => {
  let controller: OntologyController;

  const mockOntology = {
    getHomeSnapshot: jest.fn(),
    compose: jest.fn(),
    getSelf: jest.fn(),
    getEmotional: jest.fn(),
    getRelational: jest.fn(),
  };

  const mockSynthesis = {
    runSynthesis: jest.fn().mockResolvedValue(undefined),
  };

  const mockPrisma = {
    relationshipPerson: {
      findMany: jest.fn(),
    },
  };

  const req = { user: { userId: 'user-1' } } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OntologyController],
      providers: [
        { provide: OntologyService, useValue: mockOntology },
        { provide: OntologySynthesisService, useValue: mockSynthesis },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OntologyController>(OntologyController);
  });

  describe('GET /snapshot', () => {
    it('delegates to OntologyService.getHomeSnapshot with userId', async () => {
      const fakeSnap = { trajectory: 'x', weather: 'calm' };
      mockOntology.getHomeSnapshot.mockResolvedValue(fakeSnap);

      const out = await controller.getSnapshot(req);

      expect(out).toBe(fakeSnap);
      expect(mockOntology.getHomeSnapshot).toHaveBeenCalledWith('user-1');
    });
  });

  describe('GET /compose', () => {
    it('delegates to OntologyService.compose with userId', async () => {
      mockOntology.compose.mockResolvedValue({ self: null });
      const out = await controller.compose(req);
      expect(out).toEqual({ self: null });
      expect(mockOntology.compose).toHaveBeenCalledWith('user-1');
    });
  });

  describe('GET /refresh', () => {
    it('runs self + emotional + each active relational person and returns count', async () => {
      mockPrisma.relationshipPerson.findMany.mockResolvedValue([
        { id: 'p1' },
        { id: 'p2' },
        { id: 'p3' },
      ]);

      const out = await controller.refresh(req);

      expect(mockSynthesis.runSynthesis).toHaveBeenCalledWith('user-1', 'self', null);
      expect(mockSynthesis.runSynthesis).toHaveBeenCalledWith('user-1', 'emotional', null);
      expect(mockSynthesis.runSynthesis).toHaveBeenCalledWith('user-1', 'relational', 'p1');
      expect(mockSynthesis.runSynthesis).toHaveBeenCalledWith('user-1', 'relational', 'p2');
      expect(mockSynthesis.runSynthesis).toHaveBeenCalledWith('user-1', 'relational', 'p3');
      expect(mockSynthesis.runSynthesis).toHaveBeenCalledTimes(5);
      expect(out).toEqual({ ok: true, relationalCount: 3 });
    });

    it('returns relationalCount=0 when the user has no active people', async () => {
      mockPrisma.relationshipPerson.findMany.mockResolvedValue([]);

      const out = await controller.refresh(req);

      expect(mockSynthesis.runSynthesis).toHaveBeenCalledTimes(2);
      expect(out).toEqual({ ok: true, relationalCount: 0 });
    });

    it('queries only active relationship persons for this user', async () => {
      mockPrisma.relationshipPerson.findMany.mockResolvedValue([]);
      await controller.refresh(req);
      expect(mockPrisma.relationshipPerson.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isActive: true },
        select: { id: true },
      });
    });
  });

  describe('GET /self', () => {
    it('delegates to OntologyService.getSelf', async () => {
      mockOntology.getSelf.mockResolvedValue({ identity: { displayName: 'a' } });
      const out = await controller.getSelf(req);
      expect(out).toEqual({ identity: { displayName: 'a' } });
      expect(mockOntology.getSelf).toHaveBeenCalledWith('user-1');
    });
  });

  describe('GET /emotional', () => {
    it('delegates to OntologyService.getEmotional', async () => {
      mockOntology.getEmotional.mockResolvedValue({ currentWeather: 'low' });
      const out = await controller.getEmotional(req);
      expect(out).toEqual({ currentWeather: 'low' });
      expect(mockOntology.getEmotional).toHaveBeenCalledWith('user-1');
    });
  });

  describe('GET /relational/:personId', () => {
    it('returns the first relational snapshot when present', async () => {
      const snap = { personId: 'p1', bondStrength: 0.7 };
      mockOntology.getRelational.mockResolvedValue([snap]);

      const out = await controller.getRelationalOne(req, 'p1');

      expect(out).toBe(snap);
      expect(mockOntology.getRelational).toHaveBeenCalledWith('user-1', {
        personIds: ['p1'],
      });
    });

    it('returns null when no snapshot exists for the person', async () => {
      mockOntology.getRelational.mockResolvedValue([]);
      const out = await controller.getRelationalOne(req, 'missing');
      expect(out).toBeNull();
    });
  });
});
