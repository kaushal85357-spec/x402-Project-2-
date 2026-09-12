import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';

const TRANSPORT_FRICTION_FEE_PER_KM = 0.05;
const WAIT_INDEX_SCALE = 100;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ProcurementCenter {
  id: string;
  name: string;
  cropType: 'wheat';
  baseMspPerTon: number;
  distanceKm?: number;
  remainingCapacityTons: number;
  queue: QueueEntry[];
  totalOfftakeTons: number;
}

export interface QueueEntry {
  farmerId: string;
  cropType: string;
  quantityTons: number;
  tokenId: string;
  joinedAt: string;
  queueIndex: number;
  estimatedWaitTimeIndex: number;
}

export interface FarmerRecord {
  farmerId: string;
  cropType: string;
  quantityTons: number;
  coordinates?: Coordinates;
  registrationTokens: string[];
  queueIndices: Record<string, number>;
  activeCenterIds: string[];
  registeredAt: string;
}

export interface AgriProcurementStore {
  centers: Map<string, ProcurementCenter>;
  farmers: Map<string, FarmerRecord>;
}

export interface CenterDistance {
  centerId: string;
  distanceKm: number;
}

export interface AIRouteQuery {
  cropType: string;
  quantity: number;
  farmerCoordinates?: Coordinates;
  distanceToCenters: CenterDistance[] | Record<string, number>;
}

export interface RouteOption {
  centerId: string;
  centerName: string;
  distanceKm: number;
  mspPerTon: number;
  grossValue: number;
  transportFrictionFee: number;
  netValue: number;
  recommended: boolean;
  explanation: string;
}

export interface AIRouteResult {
  cropType: string;
  quantityTons: number;
  options: RouteOption[];
  recommendedCenterId: string;
  recommendation: string;
  calculatedAt: string;
}

export interface JoinQueuesRequest {
  farmerId: string;
  cropType: string;
  quantity: number;
  centerIds: string[];
  farmerCoordinates?: Coordinates;
}

export interface QueueRegistration {
  centerId: string;
  centerName: string;
  tokenId: string;
  qrPayload: string;
  queueIndex: number;
  estimatedWaitTimeIndex: number;
}

export interface JoinQueuesResult {
  farmer: FarmerRecord;
  registrations: QueueRegistration[];
}

export interface CompleteTransactionResult {
  farmerId: string;
  completedCenterId: string;
  completedCenterName: string;
  offtakeTons: number;
  remainingCapacityTons: number;
  prunedCenterIds: string[];
  completedAt: string;
}

export class ProcurementValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ProcurementValidationError';
  }
}

const initialCenters: ProcurementCenter[] = [
  {
    id: 'central-mandi-hub',
    name: 'Central Mandi Hub',
    cropType: 'wheat',
    baseMspPerTon: 275,
    remainingCapacityTons: 180,
    queue: [],
    totalOfftakeTons: 0,
  },
  {
    id: 'state-silo-alpha',
    name: 'State Silo Alpha',
    cropType: 'wheat',
    baseMspPerTon: 290,
    remainingCapacityTons: 45,
    queue: [],
    totalOfftakeTons: 0,
  },
  {
    id: 'regional-cooperative-beta',
    name: 'Regional Cooperative Beta',
    cropType: 'wheat',
    baseMspPerTon: 260,
    remainingCapacityTons: 400,
    queue: [],
    totalOfftakeTons: 0,
  },
];

export const procurementStore: AgriProcurementStore = {
  centers: new Map(initialCenters.map((center) => [center.id, center])),
  farmers: new Map(),
};

function assertNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ProcurementValidationError(`${fieldName} is required`);
  }
  return normalized;
}

function assertPositiveNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ProcurementValidationError(`${fieldName} must be a positive number`);
  }
  return value;
}

function assertCoordinates(coordinates?: Coordinates): void {
  if (!coordinates) return;
  if (
    !Number.isFinite(coordinates.latitude) ||
    coordinates.latitude < -90 ||
    coordinates.latitude > 90 ||
    !Number.isFinite(coordinates.longitude) ||
    coordinates.longitude < -180 ||
    coordinates.longitude > 180
  ) {
    throw new ProcurementValidationError('farmerCoordinates must contain valid latitude and longitude');
  }
}

function normalizeCropType(cropType: string): string {
  const normalized = assertNonEmpty(cropType, 'cropType').toLowerCase();
  if (normalized !== 'wheat') {
    throw new ProcurementValidationError('Only wheat procurement is currently supported');
  }
  return normalized;
}

function getCenter(centerId: string): ProcurementCenter {
  const center = procurementStore.centers.get(centerId);
  if (!center) {
    throw new ProcurementValidationError(`Unknown procurement center: ${centerId}`);
  }
  return center;
}

function normalizeDistances(
  distances: CenterDistance[] | Record<string, number>
): Map<string, number> {
  const entries = Array.isArray(distances)
    ? distances.map(({ centerId, distanceKm }) => [centerId, distanceKm] as const)
    : Object.entries(distances);

  if (entries.length === 0) {
    throw new ProcurementValidationError('distanceToCenters must include at least one center');
  }

  const normalized = new Map<string, number>();
  for (const [centerId, distanceKm] of entries) {
    const id = assertNonEmpty(centerId, 'centerId');
    if (!Number.isFinite(distanceKm) || distanceKm < 0) {
      throw new ProcurementValidationError(`distanceKm for ${id} must be zero or greater`);
    }
    getCenter(id);
    normalized.set(id, distanceKm);
  }
  return normalized;
}

function refreshQueueMetadata(center: ProcurementCenter): void {
  center.queue.forEach((entry, index) => {
    entry.queueIndex = index + 1;
    entry.estimatedWaitTimeIndex = Math.round(
      ((index + 1) * WAIT_INDEX_SCALE) / Math.max(center.remainingCapacityTons, 1)
    );
    const farmer = procurementStore.farmers.get(entry.farmerId);
    if (farmer) farmer.queueIndices[center.id] = entry.queueIndex;
  });
}

function makeTokenId(): string {
  return `agr-${randomUUID()}`;
}

function makeQrPayload(tokenId: string, farmerId: string, centerId: string): string {
  return Buffer.from(
    JSON.stringify({ tokenId, farmerId, centerId, issuedAt: new Date().toISOString() })
  ).toString('base64url');
}

export function handleAIRouteQuery(query: AIRouteQuery): AIRouteResult {
  const cropType = normalizeCropType(query.cropType);
  const quantity = assertPositiveNumber(query.quantity, 'quantity');
  assertCoordinates(query.farmerCoordinates);
  const distances = normalizeDistances(query.distanceToCenters);

  const options = [...distances.entries()]
    .map(([centerId, distanceKm]) => {
      const center = getCenter(centerId);
      const grossValue = quantity * center.baseMspPerTon;
      const transportFrictionFee = distanceKm * TRANSPORT_FRICTION_FEE_PER_KM;
      return {
        centerId,
        centerName: center.name,
        distanceKm,
        mspPerTon: center.baseMspPerTon,
        grossValue,
        transportFrictionFee,
        netValue: grossValue - transportFrictionFee,
        recommended: false,
        explanation: '',
      };
    })
    .sort((left, right) => right.netValue - left.netValue);

  const recommended = options[0];
  if (!recommended) {
    throw new ProcurementValidationError('No eligible procurement centers were provided');
  }
  recommended.recommended = true;
  recommended.explanation = `${recommended.centerName} is optimal because its net value is highest at $${recommended.netValue.toFixed(2)} after subtracting the $${recommended.transportFrictionFee.toFixed(2)} transport friction fee from the $${recommended.grossValue.toFixed(2)} gross MSP value.`;

  return {
    cropType,
    quantityTons: quantity,
    options,
    recommendedCenterId: recommended.centerId,
    recommendation: recommended.explanation,
    calculatedAt: new Date().toISOString(),
  };
}

export function handleJoinQueues(request: JoinQueuesRequest): JoinQueuesResult {
  const farmerId = assertNonEmpty(request.farmerId, 'farmerId');
  const cropType = normalizeCropType(request.cropType);
  const quantity = assertPositiveNumber(request.quantity, 'quantity');
  assertCoordinates(request.farmerCoordinates);
  if (!Array.isArray(request.centerIds) || request.centerIds.length === 0) {
    throw new ProcurementValidationError('centerIds must contain at least one center');
  }

  const centerIds = [...new Set(request.centerIds.map((id) => assertNonEmpty(id, 'centerId')))];
  centerIds.forEach((centerId) => getCenter(centerId));
  const existingFarmer = procurementStore.farmers.get(farmerId);
  if (existingFarmer?.activeCenterIds.length) {
    throw new ProcurementValidationError(`Farmer ${farmerId} already has active queue registrations`);
  }

  const now = new Date().toISOString();
  const farmer: FarmerRecord = existingFarmer ?? {
    farmerId,
    cropType,
    quantityTons: quantity,
    coordinates: request.farmerCoordinates,
    registrationTokens: [],
    queueIndices: {},
    activeCenterIds: [],
    registeredAt: now,
  };
  farmer.cropType = cropType;
  farmer.quantityTons = quantity;
  farmer.coordinates = request.farmerCoordinates;

  const registrations: QueueRegistration[] = [];
  procurementStore.farmers.set(farmerId, farmer);
  for (const centerId of centerIds) {
    const center = getCenter(centerId);
    const tokenId = makeTokenId();
    const entry: QueueEntry = {
      farmerId,
      cropType,
      quantityTons: quantity,
      tokenId,
      joinedAt: now,
      queueIndex: center.queue.length + 1,
      estimatedWaitTimeIndex: 0,
    };
    center.queue.push(entry);
    refreshQueueMetadata(center);
    farmer.registrationTokens.push(tokenId);
    farmer.activeCenterIds.push(centerId);
    registrations.push({
      centerId,
      centerName: center.name,
      tokenId,
      qrPayload: makeQrPayload(tokenId, farmerId, centerId),
      queueIndex: entry.queueIndex,
      estimatedWaitTimeIndex: entry.estimatedWaitTimeIndex,
    });
  }

  return { farmer: { ...farmer, activeCenterIds: [...farmer.activeCenterIds] }, registrations };
}

export function handleCompleteTransaction(
  farmerIdInput: string,
  completedCenterIdInput: string
): CompleteTransactionResult {
  const farmerId = assertNonEmpty(farmerIdInput, 'farmerId');
  const completedCenterId = assertNonEmpty(completedCenterIdInput, 'completedCenterId');
  const farmer = procurementStore.farmers.get(farmerId);
  if (!farmer) throw new ProcurementValidationError(`No active farmer registration for ${farmerId}`);

  const completedCenter = getCenter(completedCenterId);
  const completedEntryIndex = completedCenter.queue.findIndex((entry) => entry.farmerId === farmerId);
  if (completedEntryIndex === -1) {
    throw new ProcurementValidationError(`Farmer ${farmerId} is not queued at ${completedCenterId}`);
  }
  if (farmer.quantityTons > completedCenter.remainingCapacityTons) {
    throw new ProcurementValidationError(`Insufficient remaining capacity at ${completedCenter.name}`);
  }

  completedCenter.queue.splice(completedEntryIndex, 1);
  completedCenter.remainingCapacityTons -= farmer.quantityTons;
  completedCenter.totalOfftakeTons += farmer.quantityTons;
  refreshQueueMetadata(completedCenter);

  const prunedCenterIds: string[] = [];
  for (const center of procurementStore.centers.values()) {
    if (center.id === completedCenterId) continue;
    const before = center.queue.length;
    center.queue = center.queue.filter((entry) => entry.farmerId !== farmerId);
    if (center.queue.length !== before) {
      refreshQueueMetadata(center);
      prunedCenterIds.push(center.id);
    }
  }

  procurementStore.farmers.delete(farmerId);
  return {
    farmerId,
    completedCenterId,
    completedCenterName: completedCenter.name,
    offtakeTons: farmer.quantityTons,
    remainingCapacityTons: completedCenter.remainingCapacityTons,
    prunedCenterIds,
    completedAt: new Date().toISOString(),
  };
}

export async function handleAIRouteQueryRequest(c: Context): Promise<Response> {
  try {
    return c.json(handleAIRouteQuery(await c.req.json()));
  } catch (error) {
    return procurementErrorResponse(c, error);
  }
}

export async function handleJoinQueuesRequest(c: Context): Promise<Response> {
  try {
    return c.json(handleJoinQueues(await c.req.json()));
  } catch (error) {
    return procurementErrorResponse(c, error);
  }
}

export async function handleCompleteTransactionRequest(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();
    return c.json(handleCompleteTransaction(body.farmerId, body.completedCenterId));
  } catch (error) {
    return procurementErrorResponse(c, error);
  }
}

function procurementErrorResponse(c: Context, error: unknown): Response {
  if (error instanceof ProcurementValidationError) {
    return c.json({ error: error.message }, error.statusCode);
  }
  console.error('Error in agricultural procurement handler:', error);
  return c.json({ error: 'Failed to process agricultural procurement request' }, 500);
}