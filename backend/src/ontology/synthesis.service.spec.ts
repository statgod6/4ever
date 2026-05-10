import { OntologySynthesisService } from './synthesis.service';

describe('OntologySynthesisService', () => {
  let service: OntologySynthesisService;
  const prisma: any = {
    ontologyEvent: { findMany: jest.fn().mockResolvedValue([]) },
    ontologySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    relationshipPerson: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const selfSynth: any = { synthesize: jest.fn().mockResolvedValue(undefined) };
  const relationalSynth: any = { synthesize: jest.fn().mockResolvedValue(undefined) };
  const emotionalSynth: any = { synthesize: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OntologySynthesisService(
      prisma,
      selfSynth,
      relationalSynth,
      emotionalSynth,
    );
  });

  describe('runSynthesis dispatch', () => {
    it('runs self synthesizer for self domain', async () => {
      await service.runSynthesis('u1', 'self', null);
      expect(selfSynth.synthesize).toHaveBeenCalledWith('u1');
      expect(relationalSynth.synthesize).not.toHaveBeenCalled();
      expect(emotionalSynth.synthesize).not.toHaveBeenCalled();
    });

    it('runs emotional synthesizer for emotional domain', async () => {
      await service.runSynthesis('u1', 'emotional', null);
      expect(emotionalSynth.synthesize).toHaveBeenCalledWith('u1');
      expect(selfSynth.synthesize).not.toHaveBeenCalled();
    });

    it('runs relational synthesizer with scopeId', async () => {
      await service.runSynthesis('u1', 'relational', 'person-9');
      expect(relationalSynth.synthesize).toHaveBeenCalledWith('u1', 'person-9');
    });

    it('does NOT call relational synthesizer without scopeId', async () => {
      await service.runSynthesis('u1', 'relational', null);
      expect(relationalSynth.synthesize).not.toHaveBeenCalled();
    });

    it('swallows synthesizer errors without throwing', async () => {
      selfSynth.synthesize.mockRejectedValueOnce(new Error('boom'));
      await expect(service.runSynthesis('u1', 'self', null)).resolves.toBeUndefined();
    });
  });

  describe('scheduleSynthesis debouncing', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('debounces rapid calls into a single synthesis', async () => {
      service.scheduleSynthesis('u1', 'self', null);
      service.scheduleSynthesis('u1', 'self', null);
      service.scheduleSynthesis('u1', 'self', null);

      jest.advanceTimersByTime(59_999);
      expect(selfSynth.synthesize).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2);
      // flush microtasks so the inner async call resolves
      await Promise.resolve();
      expect(selfSynth.synthesize).toHaveBeenCalledTimes(1);
    });

    it('separately debounces different (user, domain, scopeId) keys', async () => {
      service.scheduleSynthesis('u1', 'relational', 'p1');
      service.scheduleSynthesis('u1', 'relational', 'p2');

      jest.advanceTimersByTime(60_001);
      await Promise.resolve();
      await Promise.resolve();
      expect(relationalSynth.synthesize).toHaveBeenCalledTimes(2);
      expect(relationalSynth.synthesize).toHaveBeenCalledWith('u1', 'p1');
      expect(relationalSynth.synthesize).toHaveBeenCalledWith('u1', 'p2');
    });
  });

  describe('nightlyRelationalSweep', () => {
    it('sweeps active people for each user with an ontology snapshot', async () => {
      prisma.ontologySnapshot.findMany.mockResolvedValueOnce([
        { userId: 'u1' },
        { userId: 'u2' },
      ]);
      prisma.relationshipPerson.findMany
        .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]) // u1
        .mockResolvedValueOnce([{ id: 'p3' }]); // u2

      await service.nightlyRelationalSweep();

      expect(relationalSynth.synthesize).toHaveBeenCalledTimes(3);
      expect(relationalSynth.synthesize).toHaveBeenCalledWith('u1', 'p1');
      expect(relationalSynth.synthesize).toHaveBeenCalledWith('u1', 'p2');
      expect(relationalSynth.synthesize).toHaveBeenCalledWith('u2', 'p3');
      expect(prisma.relationshipPerson.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', isActive: true },
        select: { id: true },
      });
    });

    it('is a no-op when no users have snapshots', async () => {
      prisma.ontologySnapshot.findMany.mockResolvedValueOnce([]);
      await service.nightlyRelationalSweep();
      expect(prisma.relationshipPerson.findMany).not.toHaveBeenCalled();
      expect(relationalSynth.synthesize).not.toHaveBeenCalled();
    });
  });
});
