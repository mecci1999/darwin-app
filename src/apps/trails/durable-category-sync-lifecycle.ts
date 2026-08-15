import { Model, ModelStatic, Transaction } from 'sequelize';
import { DataBaseConnectionManager } from 'db/mysql/manager';
import { DataBaseTableNames } from 'typings';
import { TrailsPortfolioCategoryTable } from 'db/mysql/models/trailsPortfolioCategory';
import { TrailsSyncChangeTable } from 'db/mysql/models/trailsSyncChange';
import { TrailsSyncMutationTable } from 'db/mysql/models/trailsSyncMutation';
import { TrailsDurablePortfolioTable } from 'db/mysql/models/trailsDurablePortfolio';
import { TrailsDurableJournalTable } from 'db/mysql/models/trailsDurableJournal';
import { TrailsRichDocumentTable } from 'db/mysql/models/trailsRichDocument';
import { TrailsRichDocumentRevisionTable } from 'db/mysql/models/trailsRichDocumentRevision';
import { TrailsDurableHikeTable } from 'db/mysql/models/trailsDurableHike';
import { TrailsDurableGearTable } from 'db/mysql/models/trailsDurableGear';
import { TrailsDurablePackingPlanTable } from 'db/mysql/models/trailsDurablePackingPlan';
import { TrailsDurablePackingPlanItemTable } from 'db/mysql/models/trailsDurablePackingPlanItem';
import { TrailsDurableFinanceTable } from 'db/mysql/models/trailsDurableFinance';
import { TrailsDurableFinanceDeletionAuditTable } from 'db/mysql/models/trailsDurableFinanceDeletionAudit';
import { TrailsDurableFinanceBalanceSnapshotTable } from 'db/mysql/models/trailsDurableFinanceBalanceSnapshot';
import { TrailsDurableMediaCommerceTable } from 'db/mysql/models/trailsDurableMediaCommerce';
import { TrailsDurableMediaCommerceMutationTable } from 'db/mysql/models/trailsDurableMediaCommerceMutation';
import { TrailsMediaAssetRegistryTable } from 'db/mysql/models/trailsMediaAssetRegistry';
import { TrailsMediaAssetVariantTable } from 'db/mysql/models/trailsMediaAssetVariant';
import { TrailsMediaAssetArtifactTable } from 'db/mysql/models/trailsMediaAssetArtifact';
import { TrailsMediaAssetRegistryMutationTable } from 'db/mysql/models/trailsMediaAssetRegistryMutation';
import { TrailsTrustedPhotoshopIngestionOperationTable } from 'db/mysql/models/trailsTrustedPhotoshopIngestionOperation';
import { TrailsTrustedPhotoshopIngestionArtifactTable } from 'db/mysql/models/trailsTrustedPhotoshopIngestionArtifact';
import { TrailsTrustedPhotoshopStorageWriteFenceTable } from 'db/mysql/models/trailsTrustedPhotoshopStorageWriteFence';
import { TrailsDurablePublishingPackageTable } from 'db/mysql/models/trailsDurablePublishingPackage';
import { TrailsDurablePublishingPackageMutationTable } from 'db/mysql/models/trailsDurablePublishingPackageMutation';
import { TrailsDurablePublishingPackageAuditTable } from 'db/mysql/models/trailsDurablePublishingPackageAudit';
import { TrailsPublicSiteContentTable } from 'db/mysql/models/trailsPublicSiteContent';
import { TrailsGuestCommentTable } from 'db/mysql/models/trailsGuestComment';
import { TrailsGuestCommentAuditTable } from 'db/mysql/models/trailsGuestCommentAudit';
import { TrailsGuestCommentNotificationTable } from 'db/mysql/models/trailsGuestCommentNotification';
import { TrailsDurableGuidedTripTable } from 'db/mysql/models/trailsDurableGuidedTrip';
import { TrailsDurableGuidedTripMutationTable } from 'db/mysql/models/trailsDurableGuidedTripMutation';
import { TrailsDurableGuidedTripAuditTable } from 'db/mysql/models/trailsDurableGuidedTripAudit';
import { TrailsDurableExternalVideoReferenceTable } from 'db/mysql/models/trailsDurableExternalVideoReference';
import { TrailsDurableExternalVideoReferenceMutationTable } from 'db/mysql/models/trailsDurableExternalVideoReferenceMutation';
import { TrailsDurableExternalVideoReferenceAuditTable } from 'db/mysql/models/trailsDurableExternalVideoReferenceAudit';
import { TrailsDurableLocationCardTable } from 'db/mysql/models/trailsDurableLocationCard';
import { TrailsDurableLocationCardMutationTable } from 'db/mysql/models/trailsDurableLocationCardMutation';
import { TrailsDurableLocationCardAuditTable } from 'db/mysql/models/trailsDurableLocationCardAudit';
import { TrailsShootingLocationTable } from 'db/mysql/models/trailsShootingLocation';
import { TrailsShootingLocationMutationTable } from 'db/mysql/models/trailsShootingLocationMutation';
import { TrailsShootingLocationAuditTable } from 'db/mysql/models/trailsShootingLocationAudit';
import { createSequelizeTrailsPortfolioCategorySyncModels, MySqlPortfolioCategorySyncRepository, TrailsSyncConnection } from './repository/mysqlPortfolioCategorySync';
import { createSequelizeDurablePortfolioModel, MySqlDurablePortfolioRepository } from './repository/mysqlDurablePortfolio';
import { createSequelizeDurableJournalModel, MySqlDurableJournalRepository } from './repository/mysqlDurableJournal';
import { createRichDocumentMediaValidator, createRichDocumentPublishValidator, createSequelizeRichDocumentModels, MySqlRichDocumentRepository } from './repository/mysqlRichDocument';
import { createSequelizeDurableHikeModel, MySqlDurableHikeRepository } from './repository/mysqlDurableHike';
import { createSequelizeDurableGearModel, MySqlDurableGearRepository } from './repository/mysqlDurableGear';
import { createSequelizeDurablePackingPlanModels, MySqlDurablePackingPlanRepository } from './repository/mysqlDurablePackingPlan';
import { createSequelizeDurableFinanceModels, MySqlDurableFinanceRepository } from './repository/mysqlDurableFinance';
import { createSequelizeDurableMediaCommerceModels, MySqlDurableMediaCommerceRepository } from './repository/mysqlDurableMediaCommerce';
import { createSequelizeMediaAssetRegistryModels, MySqlMediaAssetRegistryRepository } from './repository/mysqlMediaAssetRegistry';
import { createSequelizeDurablePublishingPackageModels, MySqlDurablePublishingPackageRepository } from './repository/mysqlDurablePublishingPackage';
import { createSequelizePublicSiteContentModel, MySqlPublicSiteContentRepository } from './repository/mysqlPublicSiteContent';
import { createSequelizeGuestCommentStorage, MySqlGuestCommentRepository } from './repository/mysqlGuestComment';
import { createSequelizeDurableGuidedTripModels, MySqlDurableGuidedTripRepository } from './repository/mysqlDurableGuidedTrip';
import { createSequelizeDurableExternalVideoReferenceModels, MySqlDurableExternalVideoReferenceRepository } from './repository/mysqlDurableExternalVideoReference';
import { createSequelizeDurableLocationCardModels, MySqlDurableLocationCardRepository } from './repository/mysqlDurableLocationCard';
import { createSequelizeShootingLocationModels, MySqlShootingLocationRepository } from './repository/mysqlShootingLocation';
import { MySqlDurableAnalyticsRepository } from './repository/mysqlDurableAnalytics';
import { MySqlDurableTripRegistrationRepository } from './repository/mysqlDurableTripRegistration';
import { TrailsState } from './types';

export const durableCategorySyncModelKeys = [
  DataBaseTableNames.TrailsPortfolioCategory,
  DataBaseTableNames.TrailsSyncChange,
  DataBaseTableNames.TrailsSyncMutation,
  DataBaseTableNames.TrailsDurablePortfolio,
  DataBaseTableNames.TrailsDurableJournal,
  DataBaseTableNames.TrailsRichDocument,
  DataBaseTableNames.TrailsRichDocumentRevision,
  DataBaseTableNames.TrailsDurableHike,
  DataBaseTableNames.TrailsDurableGear,
  DataBaseTableNames.TrailsDurablePackingPlan,
  DataBaseTableNames.TrailsDurablePackingPlanItem,
  DataBaseTableNames.TrailsDurableFinance,
  DataBaseTableNames.TrailsDurableFinanceBalanceSnapshot,
  DataBaseTableNames.TrailsDurableFinanceDeletionAudit,
  DataBaseTableNames.TrailsDurableMediaCommerce,
  DataBaseTableNames.TrailsDurableMediaCommerceMutation,
  DataBaseTableNames.TrailsMediaAssetRegistry,
  DataBaseTableNames.TrailsMediaAssetVariant,
  DataBaseTableNames.TrailsMediaAssetArtifact,
  DataBaseTableNames.TrailsMediaAssetRegistryMutation,
  DataBaseTableNames.TrailsTrustedPhotoshopIngestionOperation,
  DataBaseTableNames.TrailsTrustedPhotoshopIngestionArtifact,
  DataBaseTableNames.TrailsTrustedPhotoshopStorageWriteFence,
  DataBaseTableNames.TrailsDurablePublishingPackage,
  DataBaseTableNames.TrailsDurablePublishingPackageMutation,
  DataBaseTableNames.TrailsDurablePublishingPackageAudit,
  DataBaseTableNames.TrailsPublicSiteContent,
  DataBaseTableNames.TrailsGuestComment,
  DataBaseTableNames.TrailsGuestCommentAudit,
  DataBaseTableNames.TrailsGuestCommentNotification,
  DataBaseTableNames.TrailsDurableGuidedTrip,
  DataBaseTableNames.TrailsDurableGuidedTripMutation,
  DataBaseTableNames.TrailsDurableGuidedTripAudit,
  DataBaseTableNames.TrailsDurableExternalVideoReference,
  DataBaseTableNames.TrailsDurableExternalVideoReferenceMutation,
  DataBaseTableNames.TrailsDurableExternalVideoReferenceAudit,
  DataBaseTableNames.TrailsDurableLocationCard,
  DataBaseTableNames.TrailsDurableLocationCardMutation,
  DataBaseTableNames.TrailsDurableLocationCardAudit,
  DataBaseTableNames.TrailsShootingLocation,
  DataBaseTableNames.TrailsShootingLocationMutation,
  DataBaseTableNames.TrailsShootingLocationAudit,
] as const;

type DurableCategorySyncModelKey = typeof durableCategorySyncModelKeys[number];

export interface DurableCategorySyncConnection extends TrailsSyncConnection {
  authenticate(): Promise<void>;
  close(): Promise<void>;
  getModel<T extends Model>(key: DurableCategorySyncModelKey): ModelStatic<T> | undefined;
  query(sql: string, options: { replacements: unknown[]; transaction: object }): Promise<[unknown, unknown]>;
}

export interface DurableCategorySyncConnectionFactory {
  create(): DurableCategorySyncConnection;
}

/**
 * Creates a manager scoped solely to the durable Trails slice. It is deliberately
 * separate from the global manager and mainConnection, and never synchronizes schema.
 */
export class PrivateDurableCategorySyncConnectionFactory implements DurableCategorySyncConnectionFactory {
  create(): DurableCategorySyncConnection {
    const manager = new DataBaseConnectionManager();
    const connection = manager.getConnection({}, { models: [...durableCategorySyncModelKeys] });

    return {
      authenticate: () => connection.authenticate(),
      close: async () => {
        const index = manager.connections.findIndex((entry) => entry.connection === connection);
        if (index !== -1) manager.connections.splice(index, 1);
        await connection.close();
      },
      getModel<T extends Model>(key: DurableCategorySyncModelKey): ModelStatic<T> | undefined {
        return connection.models[key] as ModelStatic<T> | undefined;
      },
        transaction: async <T>(work: (transaction: object) => Promise<T>): Promise<T> => connection.transaction(async (transaction) => work(transaction)),
        query: async (sql, options) => {
          if (!(options.transaction instanceof Transaction)) throw new Error('Trails analytics query requires a managed transaction');
          return connection.query(sql, { replacements: options.replacements, transaction: options.transaction });
        },
    };
  }
}

/** Owns every currently composed durable Trails v2 store on one private connection. */
export class DurableCategorySyncLifecycle {
  private connection: DurableCategorySyncConnection | undefined;

  constructor(private readonly connectionFactory: DurableCategorySyncConnectionFactory = new PrivateDurableCategorySyncConnectionFactory()) {}

  async start(state: TrailsState): Promise<void> {
    if (this.connection) throw new Error('Trails durable persistence is already started');

    const connection = this.connectionFactory.create();
    try {
      await connection.authenticate();
      const categories = connection.getModel<TrailsPortfolioCategoryTable>(DataBaseTableNames.TrailsPortfolioCategory);
      const changes = connection.getModel<TrailsSyncChangeTable>(DataBaseTableNames.TrailsSyncChange);
      const mutations = connection.getModel<TrailsSyncMutationTable>(DataBaseTableNames.TrailsSyncMutation);
      const portfolios = connection.getModel<TrailsDurablePortfolioTable>(DataBaseTableNames.TrailsDurablePortfolio);
      const journals = connection.getModel<TrailsDurableJournalTable>(DataBaseTableNames.TrailsDurableJournal);
      const richDocuments = connection.getModel<TrailsRichDocumentTable>(DataBaseTableNames.TrailsRichDocument);
      const richDocumentRevisions = connection.getModel<TrailsRichDocumentRevisionTable>(DataBaseTableNames.TrailsRichDocumentRevision);
      const hikes = connection.getModel<TrailsDurableHikeTable>(DataBaseTableNames.TrailsDurableHike);
      const gear = connection.getModel<TrailsDurableGearTable>(DataBaseTableNames.TrailsDurableGear);
      const packingPlans = connection.getModel<TrailsDurablePackingPlanTable>(DataBaseTableNames.TrailsDurablePackingPlan);
      const packingPlanItems = connection.getModel<TrailsDurablePackingPlanItemTable>(DataBaseTableNames.TrailsDurablePackingPlanItem);
      const finance = connection.getModel<TrailsDurableFinanceTable>(DataBaseTableNames.TrailsDurableFinance);
      const financeBalanceSnapshots = connection.getModel<TrailsDurableFinanceBalanceSnapshotTable>(DataBaseTableNames.TrailsDurableFinanceBalanceSnapshot);
      const financeDeletionAudits = connection.getModel<TrailsDurableFinanceDeletionAuditTable>(DataBaseTableNames.TrailsDurableFinanceDeletionAudit);
      const commerce = connection.getModel<TrailsDurableMediaCommerceTable>(DataBaseTableNames.TrailsDurableMediaCommerce);
      const commerceMutations = connection.getModel<TrailsDurableMediaCommerceMutationTable>(DataBaseTableNames.TrailsDurableMediaCommerceMutation);
      const mediaAssets = connection.getModel<TrailsMediaAssetRegistryTable>(DataBaseTableNames.TrailsMediaAssetRegistry);
      const mediaVariants = connection.getModel<TrailsMediaAssetVariantTable>(DataBaseTableNames.TrailsMediaAssetVariant);
      const mediaArtifacts = connection.getModel<TrailsMediaAssetArtifactTable>(DataBaseTableNames.TrailsMediaAssetArtifact);
      const mediaAssetMutations = connection.getModel<TrailsMediaAssetRegistryMutationTable>(DataBaseTableNames.TrailsMediaAssetRegistryMutation);
      const ingestionOperations = connection.getModel<TrailsTrustedPhotoshopIngestionOperationTable>(DataBaseTableNames.TrailsTrustedPhotoshopIngestionOperation);
      const ingestionArtifacts = connection.getModel<TrailsTrustedPhotoshopIngestionArtifactTable>(DataBaseTableNames.TrailsTrustedPhotoshopIngestionArtifact);
      const storageWriteFences = connection.getModel<TrailsTrustedPhotoshopStorageWriteFenceTable>(DataBaseTableNames.TrailsTrustedPhotoshopStorageWriteFence);
      const publishingPackages = connection.getModel<TrailsDurablePublishingPackageTable>(DataBaseTableNames.TrailsDurablePublishingPackage);
      const publishingPackageMutations = connection.getModel<TrailsDurablePublishingPackageMutationTable>(DataBaseTableNames.TrailsDurablePublishingPackageMutation);
      const publishingPackageAudits = connection.getModel<TrailsDurablePublishingPackageAuditTable>(DataBaseTableNames.TrailsDurablePublishingPackageAudit);
      const publicSiteContent = connection.getModel<TrailsPublicSiteContentTable>(DataBaseTableNames.TrailsPublicSiteContent);
      const guestComments = connection.getModel<TrailsGuestCommentTable>(DataBaseTableNames.TrailsGuestComment);
      const guestCommentAudits = connection.getModel<TrailsGuestCommentAuditTable>(DataBaseTableNames.TrailsGuestCommentAudit);
      const guestCommentNotifications = connection.getModel<TrailsGuestCommentNotificationTable>(DataBaseTableNames.TrailsGuestCommentNotification);
      const guidedTrips = connection.getModel<TrailsDurableGuidedTripTable>(DataBaseTableNames.TrailsDurableGuidedTrip);
      const guidedTripMutations = connection.getModel<TrailsDurableGuidedTripMutationTable>(DataBaseTableNames.TrailsDurableGuidedTripMutation);
      const guidedTripAudits = connection.getModel<TrailsDurableGuidedTripAuditTable>(DataBaseTableNames.TrailsDurableGuidedTripAudit);
      const externalVideoReferences = connection.getModel<TrailsDurableExternalVideoReferenceTable>(DataBaseTableNames.TrailsDurableExternalVideoReference);
      const externalVideoReferenceMutations = connection.getModel<TrailsDurableExternalVideoReferenceMutationTable>(DataBaseTableNames.TrailsDurableExternalVideoReferenceMutation);
      const externalVideoReferenceAudits = connection.getModel<TrailsDurableExternalVideoReferenceAuditTable>(DataBaseTableNames.TrailsDurableExternalVideoReferenceAudit);
      const locationCards = connection.getModel<TrailsDurableLocationCardTable>(DataBaseTableNames.TrailsDurableLocationCard);
      const locationCardMutations = connection.getModel<TrailsDurableLocationCardMutationTable>(DataBaseTableNames.TrailsDurableLocationCardMutation);
      const locationCardAudits = connection.getModel<TrailsDurableLocationCardAuditTable>(DataBaseTableNames.TrailsDurableLocationCardAudit);
      const shootingLocations = connection.getModel<TrailsShootingLocationTable>(DataBaseTableNames.TrailsShootingLocation);
      const shootingLocationMutations = connection.getModel<TrailsShootingLocationMutationTable>(DataBaseTableNames.TrailsShootingLocationMutation);
      const shootingLocationAudits = connection.getModel<TrailsShootingLocationAuditTable>(DataBaseTableNames.TrailsShootingLocationAudit);
      const notificationKey = process.env.TRAILS_GUEST_COMMENT_NOTIFICATION_KEY;
      if (!categories || !changes || !mutations || !portfolios || !journals || !richDocuments || !richDocumentRevisions || !hikes || !gear || !packingPlans || !packingPlanItems || !finance || !financeBalanceSnapshots || !financeDeletionAudits || !commerce || !commerceMutations || !mediaAssets || !mediaVariants || !mediaArtifacts || !mediaAssetMutations || !ingestionOperations || !ingestionArtifacts || !storageWriteFences || !publishingPackages || !publishingPackageMutations || !publishingPackageAudits || !publicSiteContent || !guestComments || !guestCommentAudits || !guestCommentNotifications || !guidedTrips || !guidedTripMutations || !guidedTripAudits || !externalVideoReferences || !externalVideoReferenceMutations || !externalVideoReferenceAudits || !locationCards || !locationCardMutations || !locationCardAudits || !shootingLocations || !shootingLocationMutations || !shootingLocationAudits || !notificationKey) throw new Error('Trails durable persistence models are unavailable');

      state.durablePortfolioCategorySync = new MySqlPortfolioCategorySyncRepository(
        connection,
        createSequelizeTrailsPortfolioCategorySyncModels({ categories, changes, mutations }),
      );
      const richDocumentModels = createSequelizeRichDocumentModels(richDocuments, richDocumentRevisions, portfolios, journals);
      const mediaAssetModels = createSequelizeMediaAssetRegistryModels(mediaAssets, mediaVariants, mediaArtifacts, mediaAssetMutations);
      const richDocumentMediaValidator = createRichDocumentMediaValidator(mediaAssetModels);
      const richDocumentPublishValidator = createRichDocumentPublishValidator(richDocumentModels.documents, richDocumentMediaValidator);
      state.durablePortfolioStore = new MySqlDurablePortfolioRepository(connection, createSequelizeDurablePortfolioModel(portfolios), { find: async (input, options) => {
        const transaction = options.transaction;
        if (!(transaction instanceof Transaction)) throw new Error('Trails durable portfolio category lookup requires a managed transaction');
        const category = await categories.findOne({ where: input, transaction, lock: transaction.LOCK.UPDATE });
        return category ? { ownerUserId: category.ownerUserId, visibility: category.visibility, status: category.status, lifecycle: category.lifecycle } : undefined;
      } }, undefined, richDocumentPublishValidator);
      state.durableJournalStore = new MySqlDurableJournalRepository(connection, createSequelizeDurableJournalModel(journals), undefined, richDocumentPublishValidator);
      state.durableRichDocumentStore = new MySqlRichDocumentRepository(connection, richDocumentModels.documents, richDocumentModels.revisions, richDocumentModels.subjects, richDocumentMediaValidator);
      state.durableHikeStore = new MySqlDurableHikeRepository(connection, createSequelizeDurableHikeModel(hikes));
      state.durableGearStore = new MySqlDurableGearRepository(connection, createSequelizeDurableGearModel(gear));
      state.durablePackingPlanStore = new MySqlDurablePackingPlanRepository(connection, createSequelizeDurablePackingPlanModels(packingPlans, packingPlanItems, gear));
      const financeModels = createSequelizeDurableFinanceModels(finance, financeDeletionAudits, financeBalanceSnapshots);
      state.durableFinanceStore = new MySqlDurableFinanceRepository(connection, financeModels.finance, financeModels.audits, financeModels.snapshots);
      const commerceModels = createSequelizeDurableMediaCommerceModels(commerce, commerceMutations);
      state.durableMediaCommerceStore = new MySqlDurableMediaCommerceRepository(connection, commerceModels.records, commerceModels.mutations);
      const registry = new MySqlMediaAssetRegistryRepository(connection, mediaAssetModels);
      state.durableMediaAssetRegistryStore = registry;
      const publishingModels = createSequelizeDurablePublishingPackageModels(publishingPackages, publishingPackageMutations, publishingPackageAudits);
      state.durablePublishingPackageStore = new MySqlDurablePublishingPackageRepository(connection, publishingModels.packages, publishingModels.mutations, publishingModels.audits);
      state.durablePublicSiteContentStore = new MySqlPublicSiteContentRepository(connection, createSequelizePublicSiteContentModel(publicSiteContent));
      state.durableGuestCommentStore = new MySqlGuestCommentRepository(createSequelizeGuestCommentStorage(guestComments, guestCommentAudits, guestCommentNotifications, notificationKey), notificationKey);
      const guidedTripModels = createSequelizeDurableGuidedTripModels(guidedTrips, guidedTripMutations, guidedTripAudits);
      state.durableGuidedTripStore = new MySqlDurableGuidedTripRepository(connection, guidedTripModels.trips, guidedTripModels.mutations, guidedTripModels.audits);
      const externalVideoReferenceModels = createSequelizeDurableExternalVideoReferenceModels(externalVideoReferences, externalVideoReferenceMutations, externalVideoReferenceAudits, portfolios);
      state.durableExternalVideoReferenceStore = new MySqlDurableExternalVideoReferenceRepository(connection, externalVideoReferenceModels.references, externalVideoReferenceModels.mutations, externalVideoReferenceModels.audits, externalVideoReferenceModels.portfolios);
      const locationCardModels = createSequelizeDurableLocationCardModels(locationCards, locationCardMutations, locationCardAudits);
      state.durableLocationCardStore = new MySqlDurableLocationCardRepository(connection, locationCardModels.cards, locationCardModels.mutations, locationCardModels.audits);
      const shootingLocationModels = createSequelizeShootingLocationModels(shootingLocations, shootingLocationMutations, shootingLocationAudits);
      state.shootingLocationStore = new MySqlShootingLocationRepository(connection, shootingLocationModels.locations, shootingLocationModels.mutations, shootingLocationModels.audits);
      const analyticsSecret = process.env.TRAILS_ANALYTICS_HMAC_SECRET?.trim();
      state.durableAnalyticsStore = analyticsSecret ? new MySqlDurableAnalyticsRepository(connection, analyticsSecret) : undefined;
      state.durableTripRegistrationStore = new MySqlDurableTripRegistrationRepository(connection);
      this.connection = connection;
    } catch (error: unknown) {
      state.durablePortfolioCategorySync = undefined;
      state.durablePortfolioStore = undefined;
      state.durableJournalStore = undefined;
      state.durableRichDocumentStore = undefined;
      state.durableHikeStore = undefined;
      state.durableGearStore = undefined;
      state.durablePackingPlanStore = undefined;
      state.durableFinanceStore = undefined;
      state.durableMediaCommerceStore = undefined;
      state.durableMediaAssetRegistryStore = undefined;
      state.durablePublishingPackageStore = undefined;
      state.durablePublicSiteContentStore = undefined;
      state.durableGuestCommentStore = undefined;
      state.durableGuidedTripStore = undefined;
      state.durableExternalVideoReferenceStore = undefined;
      state.durableLocationCardStore = undefined;
      state.shootingLocationStore = undefined;
      state.durableAnalyticsStore = undefined;
      state.durableTripRegistrationStore = undefined;
      try {
        await connection.close();
      } catch {
        // Preserve the initialization failure while still making the close attempt.
      }
      throw error;
    }
  }

  async stop(state: TrailsState): Promise<void> {
    const connection = this.connection;
    try {
      if (connection) await connection.close();
    } finally {
      this.connection = undefined;
      state.durablePortfolioCategorySync = undefined;
      state.durablePortfolioStore = undefined;
      state.durableJournalStore = undefined;
      state.durableRichDocumentStore = undefined;
      state.durableHikeStore = undefined;
      state.durableGearStore = undefined;
      state.durablePackingPlanStore = undefined;
      state.durableFinanceStore = undefined;
      state.durableMediaCommerceStore = undefined;
      state.durableMediaAssetRegistryStore = undefined;
      state.durablePublishingPackageStore = undefined;
      state.durablePublicSiteContentStore = undefined;
      state.durableGuestCommentStore = undefined;
      state.durableGuidedTripStore = undefined;
      state.durableExternalVideoReferenceStore = undefined;
      state.durableLocationCardStore = undefined;
      state.shootingLocationStore = undefined;
      state.durableAnalyticsStore = undefined;
      state.durableTripRegistrationStore = undefined;
    }
  }
}

/** Compatibility composition helper that returns the lifecycle its caller must stop. */
export async function initializeDurableCategorySync(
  state: TrailsState,
  lifecycle: DurableCategorySyncLifecycle = new DurableCategorySyncLifecycle(),
): Promise<DurableCategorySyncLifecycle> {
  await lifecycle.start(state);
  return lifecycle;
}
