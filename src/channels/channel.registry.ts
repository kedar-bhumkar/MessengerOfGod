// ============================================================================
// Channel Registry
// Central registry that maps channel_type strings to ChannelInterface
// implementations. Manages lifecycle (init / shutdown) for all channels.
// ============================================================================

import { ChannelInterface } from './channel.interface.js';
import { logger } from '../utils/logger.js';

class ChannelRegistry {
  private channels = new Map<string, ChannelInterface>();

  /**
   * Register a channel implementation. Overwrites any previously registered
   * channel with the same channelType.
   */
  register(channel: ChannelInterface): void {
    if (this.channels.has(channel.channelType)) {
      logger.warn(
        { channelType: channel.channelType },
        'Overwriting previously registered channel',
      );
    }
    this.channels.set(channel.channelType, channel);
    logger.info({ channelType: channel.channelType }, 'Channel registered');
  }

  /**
   * Retrieve a channel by its type identifier.
   */
  get(channelType: string): ChannelInterface | undefined {
    return this.channels.get(channelType);
  }

  /**
   * Return all registered channel implementations.
   */
  getAll(): ChannelInterface[] {
    return Array.from(this.channels.values());
  }

  /**
   * Initialize every registered channel. Logs success or failure for each.
   */
  async initializeAll(): Promise<void> {
    const entries = Array.from(this.channels.entries());
    logger.info(
      { count: entries.length },
      'Initializing all registered channels',
    );

    for (const [channelType, channel] of entries) {
      try {
        await channel.initialize();
        logger.info({ channelType }, 'Channel initialized successfully');
      } catch (error) {
        logger.error(
          { channelType, error },
          'Failed to initialize channel',
        );
        throw error;
      }
    }

    logger.info('All channels initialized');
  }

  /**
   * Gracefully shut down every registered channel.
   */
  async shutdownAll(): Promise<void> {
    const entries = Array.from(this.channels.entries());
    logger.info(
      { count: entries.length },
      'Shutting down all registered channels',
    );

    for (const [channelType, channel] of entries) {
      try {
        await channel.shutdown();
        logger.info({ channelType }, 'Channel shut down successfully');
      } catch (error) {
        logger.error(
          { channelType, error },
          'Error shutting down channel (continuing with others)',
        );
      }
    }

    logger.info('All channels shut down');
  }
}

/** Singleton channel registry for the application. */
export const channelRegistry = new ChannelRegistry();
