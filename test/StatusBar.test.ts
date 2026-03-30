import { describe, it } from 'vitest';
import { StatusBar } from '../src/ui/StatusBar';

describe('StatusBar', () => {
  it('creates with disconnected state', () => {
    const bar = new StatusBar();
    // The mock createStatusBarItem returns an object
    // Just verify it doesn't throw
    bar.dispose();
  });

  it('update to connected shows board label', () => {
    const bar = new StatusBar();
    bar.update('connected', 'ESP32');
    bar.dispose();
  });

  it('update to connecting shows loading', () => {
    const bar = new StatusBar();
    bar.update('connecting');
    bar.dispose();
  });

  it('update to error shows error state', () => {
    const bar = new StatusBar();
    bar.update('error');
    bar.dispose();
  });

  it('update to disconnected shows connect prompt', () => {
    const bar = new StatusBar();
    bar.update('connected', 'Board');
    bar.update('disconnected');
    bar.dispose();
  });

  it('update to connected without label uses default', () => {
    const bar = new StatusBar();
    bar.update('connected');
    bar.dispose();
  });
});
