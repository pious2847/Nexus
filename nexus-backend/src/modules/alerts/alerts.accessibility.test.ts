import { describe, it, expect } from 'vitest';
import { buildAudioScript, buildAccessibleAlert } from './alerts.accessibility';

describe('buildAudioScript', () => {
  it('includes severity, hazard, headline, and a repeat', () => {
    const script = buildAudioScript({
      hazardType: 'flood',
      severity: 'severe',
      headline: 'Water rising near Tolon market',
      instruction: 'Move to higher ground immediately',
      areaDesc: 'Tolon District',
    });
    expect(script).toContain('severe flood warning for Tolon District');
    expect(script).toContain('Water rising near Tolon market');
    expect(script).toContain('What to do: Move to higher ground immediately');
    expect(script.toLowerCase()).toContain('repeat');
  });

  it('omits the instruction line when none is given', () => {
    const script = buildAudioScript({ hazardType: 'drought', severity: 'moderate', headline: 'Rainfall below normal' });
    expect(script).not.toContain('What to do');
  });

  it('handles a null severity gracefully', () => {
    const script = buildAudioScript({ hazardType: 'bushfire', severity: null, headline: 'Fire risk elevated' });
    expect(script).toContain('a bushfire warning');
  });
});

describe('buildAccessibleAlert', () => {
  it('bundles icon, color, script, and pictogram description', () => {
    const alert = buildAccessibleAlert({ hazardType: 'flood', severity: 'extreme', headline: 'Major flooding' });
    expect(alert.icon).toBe('🌊');
    expect(alert.color).toBe('#C62828');
    expect(alert.pictogramDescription).toContain('🌊');
    expect(alert.audioScript).toContain('Major flooding');
  });

  it('has a null color when severity is unknown', () => {
    const alert = buildAccessibleAlert({ hazardType: 'windstorm', severity: null, headline: 'Strong winds expected' });
    expect(alert.color).toBeNull();
  });
});
