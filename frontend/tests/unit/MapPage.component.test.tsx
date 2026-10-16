// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MapPage } from '@/pages/MapPage/MapPage';

vi.mock('@/components/LightPointsMap/LightPointsMap', () => ({ LightPointsMap: () => <div data-testid="interactive-light-points-map" /> }));

afterEach(cleanup);

describe('MapPage', () => {
  it('places the interactive inventory map inside the responsive page wrapper', () => {
    const { container } = render(<MapPage />);
    expect(screen.getByTestId('interactive-light-points-map')).toBeTruthy();
    expect(container.firstElementChild?.className).toBeTruthy();
  });
});
