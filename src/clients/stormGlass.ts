import config, { IConfig } from 'config';
import * as HTTPUtil from '@src/utils/request';
import { InternalError } from '@src/utils/errors/internal-error';
import { TimeUtil } from '@src/utils/time';
import CacheUtil from '@src/utils/cache';
import logger from '@src/logger';

export interface StormGlassPointSource {
  [key: string]: number;
}

export interface StormGlassPoint {
  time: string;
  readonly swellDirection: StormGlassPointSource;
  readonly swellHeight: StormGlassPointSource;
  readonly swellPeriod: StormGlassPointSource;
  readonly waveDirection: StormGlassPointSource;
  readonly waveHeight: StormGlassPointSource;
  readonly windDirection: StormGlassPointSource;
  readonly windSpeed: StormGlassPointSource;
}

export interface StormGlassForecastResponse {
  hours: StormGlassPoint[];
}

export interface ForecastPoint {
  time: string;
  swellDirection: number;
  swellHeight: number;
  swellPeriod: number;
  waveDirection: number;
  waveHeight: number;
  windDirection: number;
  windSpeed: number;
}

export class StormGlassUnexpectedResponseError extends InternalError {
  constructor(message: string) {
    super(message);
  }
}

export class ClientRequestError extends InternalError {
  constructor(message: string) {
    const internalMessage = `Unexpected error when trying to communicate to StormGlass`;
    super(`${internalMessage}: ${message}`);
  }
}

export class StormGlassResponseError extends InternalError {
  constructor(message: string) {
    const stormGlassErrorMessage = `Unexpected error returned by the StormGlass Service`;
    super(`${stormGlassErrorMessage}: ${message}`);
  }
}

const stormGlassResourceConfig: IConfig = config.get(
  'App.resources.StormGlass'
);

export class StormGlass {
  readonly stormGlassAPIParams =
    'swellDirection,swellHeight,swellPeriod,waveDirection,waveHeight,windDirection,windSpeed';
  readonly stormGlassAPISource = 'noaa';

  constructor(
    protected request = new HTTPUtil.Request(),
    protected cacheUtil = CacheUtil
  ) {}

  public async fetchPoints(lat: number, lng: number): Promise<ForecastPoint[]> {
    const cachedForecastPoints = this.getForecastPointsFromCache(
      this.getCacheKey(lat, lng)
    );

    if (!cachedForecastPoints) {
      const forecastPoints = await this.getForecastPointsFromApi(lat, lng);
      this.setForecastPointsInCache(this.getCacheKey(lat, lng), forecastPoints);
      return forecastPoints;
    }

    return cachedForecastPoints;
  }

  protected async getForecastPointsFromApi(
    lat: number,
    lng: number
  ): Promise<ForecastPoint[]> {
    const endTimestamp = TimeUtil.getUnixTimeForAFutureDay(1);
    try {
      const response = await this.request.get<StormGlassForecastResponse>(
        `${stormGlassResourceConfig.get(
          'apiUrl'
        )}/weather/point?lat=${lat}&lng=${lng}&params=${
          this.stormGlassAPIParams
        }&source=${this.stormGlassAPISource}&end=${endTimestamp}`,
        {
          headers: {
            Authorization: stormGlassResourceConfig.get('apiToken'),
          },
        }
      );
      return this.normalizeResponse(response.data);
    } catch (err) {
      if (HTTPUtil.Request.isRequestError(err)) {
        throw new StormGlassResponseError(
          `Error: ${JSON.stringify(err.response.data)} Code: ${
            err.response.status
          }`
        );
      }
      throw new ClientRequestError(err.message);
    }
  }

  protected getForecastPointsFromCache(
    key: string
  ): ForecastPoint[] | undefined {
    const forecastPointsFromCache = this.cacheUtil.get<ForecastPoint[]>(key);

    if (!forecastPointsFromCache) {
      return;
    }

    logger.info(`Using cache to return forecast points for key: ${key}`);
    return forecastPointsFromCache;
  }

  private getCacheKey(lat: number, lng: number): string {
    return `forecast_points_${lat}_${lng}`;
  }

  private setForecastPointsInCache(
    key: string,
    forecastPoints: ForecastPoint[]
  ): boolean {
    logger.info(`Updating cache to return forecast points for key: ${key}`);
    return this.cacheUtil.set(
      key,
      forecastPoints,
      stormGlassResourceConfig.get('cacheTtl')
    );
  }

  private normalizeResponse(
    points: StormGlassForecastResponse
  ): ForecastPoint[] {
    return points.hours.filter(this.isValidPoint.bind(this)).map((point) => ({
      time: point.time,
      swellDirection: point.swellDirection[this.stormGlassAPISource],
      swellHeight: point.swellHeight[this.stormGlassAPISource],
      swellPeriod: point.swellPeriod[this.stormGlassAPISource],
      waveDirection: point.waveDirection[this.stormGlassAPISource],
      waveHeight: point.waveHeight[this.stormGlassAPISource],
      windDirection: point.windDirection[this.stormGlassAPISource],
      windSpeed: point.windSpeed[this.stormGlassAPISource],
    }));
  }

  private isValidPoint(point: Partial<StormGlassPoint>): boolean {
    return !!(
      point.time &&
      point.swellDirection?.[this.stormGlassAPISource] &&
      point.swellHeight?.[this.stormGlassAPISource] &&
      point.swellPeriod?.[this.stormGlassAPISource] &&
      point.waveDirection?.[this.stormGlassAPISource] &&
      point.waveHeight?.[this.stormGlassAPISource] &&
      point.windDirection?.[this.stormGlassAPISource] &&
      point.windSpeed?.[this.stormGlassAPISource]
    );
  }
}
