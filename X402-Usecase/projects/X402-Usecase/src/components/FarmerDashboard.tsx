import { FormEvent, useMemo, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4021'

type Center = {
  id: string
  name: string
  distanceKm: number
  capacity: string
  capacityTone: string
  accent: string
}

type RouteOption = {
  centerId: string
  centerName: string
  distanceKm: number
  mspPerTon: number
  netValue: number
  recommended: boolean
  explanation: string
}

type RouteResult = {
  options: RouteOption[]
  recommendedCenterId: string
  recommendation: string
}

type Registration = {
  centerId: string
  centerName: string
  tokenId: string
  qrPayload: string
  queueIndex: number
  estimatedWaitTimeIndex: number
}

type CompletionResult = {
  completedCenterName: string
  completedAt: string
  prunedCenterIds: string[]
}

const CENTERS: Center[] = [
  {
    id: 'central-mandi-hub',
    name: 'Central Mandi Hub',
    distanceKm: 18,
    capacity: '180 t open',
    capacityTone: 'text-emerald-700 bg-emerald-50',
    accent: 'from-emerald-400 to-lime-300',
  },
  {
    id: 'state-silo-alpha',
    name: 'State Silo Alpha',
    distanceKm: 34,
    capacity: '45 t open',
    capacityTone: 'text-amber-700 bg-amber-50',
    accent: 'from-amber-400 to-orange-300',
  },
  {
    id: 'regional-cooperative-beta',
    name: 'Regional Cooperative Beta',
    distanceKm: 51,
    capacity: '400 t open',
    capacityTone: 'text-sky-700 bg-sky-50',
    accent: 'from-sky-400 to-cyan-300',
  },
]

function makeDistanceMap(): Record<string, number> {
  return Object.fromEntries(CENTERS.map((center) => [center.id, center.distanceKm]))
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

function QueueToken({ registration }: { registration: Registration }) {
  const pattern = useMemo(() => {
    const source = registration.qrPayload || registration.tokenId
    return Array.from({ length: 64 }, (_, index) => {
      const code = source.charCodeAt(index % source.length) + index * 13
      return code % 5 === 0 || code % 7 === 0 || code % 11 === 0
    })
  }, [registration.qrPayload, registration.tokenId])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Digital entry token</p>
          <p className="mt-1 font-mono text-xs text-slate-700">{registration.tokenId.slice(0, 22)}...</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">QR READY</span>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <div className="grid h-24 w-24 shrink-0 grid-cols-8 gap-0.5 rounded-lg bg-slate-950 p-2">
          {pattern.map((filled, index) => (
            <span key={index} className={filled ? 'bg-lime-300' : 'bg-slate-800'} />
          ))}
        </div>
        <div className="text-xs leading-5 text-slate-500">
          Scan at the weighbridge to verify this queue registration.
          <p className="mt-2 font-semibold text-slate-700">Token is unique to this farmer and center.</p>
        </div>
      </div>
    </div>
  )
}

export default function FarmerDashboard() {
  const [farmerId, setFarmerId] = useState('farmer-demo-01')
  const [region, setRegion] = useState('Vidarbha, Maharashtra')
  const [cropType, setCropType] = useState('wheat')
  const [quantity, setQuantity] = useState('12')
  const [selectedCenters, setSelectedCenters] = useState<string[]>([CENTERS[0].id, CENTERS[2].id])
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [completion, setCompletion] = useState<CompletionResult | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [queueLoading, setQueueLoading] = useState(false)
  const [completeLoading, setCompleteLoading] = useState(false)
  const [error, setError] = useState('')

  const request = async <T,>(path: string, body: Record<string, unknown>): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}`)
    return payload as T
  }

  const handleRouteRecommendation = async (event: FormEvent) => {
    event.preventDefault()
    setRouteLoading(true)
    setError('')
    try {
      const result = await request<RouteResult>('/farmer/ai-route', {
        cropType,
        quantity: Number(quantity),
        farmerCoordinates: { latitude: 20.94, longitude: 77.75 },
        distanceToCenters: makeDistanceMap(),
      })
      setRouteResult(result)
      setSelectedCenters([result.recommendedCenterId])
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setRouteLoading(false)
    }
  }

  const handleQueueRegistration = async (event: FormEvent) => {
    event.preventDefault()
    if (selectedCenters.length === 0) {
      setError('Select at least one procurement center to join.')
      return
    }
    setQueueLoading(true)
    setError('')
    setCompletion(null)
    try {
      const result = await request<{ registrations: Registration[] }>('/farmer/join-queues', {
        farmerId,
        cropType,
        quantity: Number(quantity),
        centerIds: selectedCenters,
      })
      setRegistrations(result.registrations)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setQueueLoading(false)
    }
  }

  const handleCompleteTransaction = async () => {
    const completedCenterId = registrations[0]?.centerId || routeResult?.recommendedCenterId
    if (!completedCenterId) {
      setError('Join a queue before simulating procurement completion.')
      return
    }
    setCompleteLoading(true)
    setError('')
    try {
      const result = await request<CompletionResult>('/farmer/complete-transaction', {
        farmerId,
        completedCenterId,
      })
      setCompletion(result)
      setRegistrations([])
      setRouteResult(null)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setCompleteLoading(false)
    }
  }

  const toggleCenter = (centerId: string) => {
    setSelectedCenters((current) => (current.includes(centerId) ? current.filter((id) => id !== centerId) : [...current, centerId]))
  }

  return (
    <main className="min-h-screen bg-[#f4f7f1] px-4 py-8 text-slate-900 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col justify-between gap-5 border-b border-slate-200 pb-7 sm:flex-row sm:items-end">
          <div>
            <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_12px_#22c55e]" />
              Bharat AgriFlow / Live Console
            </div>
            <h1 className="max-w-2xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">Move grain with certainty.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
              AI route selection, multi-center queue access, and clean settlement for every procurement journey.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Network status</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-bold text-slate-800">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> x402 gateway online
            </p>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
        )}
        {completion && (
          <div className="mb-6 flex flex-col justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800 sm:flex-row sm:items-center">
            <span>
              <strong>Settlement complete.</strong> {completion.completedCenterName} accepted the lot and all parallel queue records were
              pruned.
            </span>
            <span className="font-mono text-xs">{new Date(completion.completedAt).toLocaleTimeString()}</span>
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_55px_rgba(37,55,34,0.08)] sm:p-8">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">01 / Intelligence layer</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight">AI route recommendation</h2>
                <p className="mt-2 text-sm text-slate-500">Compare net value across eligible centers before you commit your harvest.</p>
              </div>
              <span className="rounded-full bg-slate-950 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-lime-300">
                POST / ai-route
              </span>
            </div>
            <form onSubmit={handleRouteRecommendation} className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">Location / region</span>
                <input
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                />
              </label>
              <label>
                <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">Crop</span>
                <select
                  value={cropType}
                  onChange={(event) => setCropType(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
                >
                  <option value="wheat">Wheat</option>
                </select>
              </label>
              <label>
                <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">Quantity (tons)</span>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
                />
              </label>
              <button
                disabled={routeLoading}
                className="sm:col-span-2 rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
              >
                {routeLoading ? 'Calculating route...' : 'Find optimal route →'}
              </button>
            </form>
            {routeResult && (
              <div className="mt-6 space-y-3">
                <div className="rounded-2xl border-2 border-emerald-400 bg-gradient-to-br from-emerald-50 to-lime-50 p-5 shadow-[0_0_24px_rgba(74,222,128,0.22)]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-black text-white">🤖 AI Optimal Selection</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">{region}</span>
                  </div>
                  <p className="mt-4 text-sm font-semibold leading-6 text-emerald-950">{routeResult.recommendation}</p>
                </div>
                {routeResult.options.map((option) => (
                  <div
                    key={option.centerId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-bold">{option.centerName}</p>
                      <p className="text-xs text-slate-500">
                        {option.distanceKm} km away · ₹{option.mspPerTon}/ton MSP
                      </p>
                    </div>
                    <p className="text-right text-sm font-black text-emerald-700">
                      ₹{option.netValue.toFixed(2)}
                      <span className="block text-[10px] font-bold uppercase text-slate-400">net value</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-[0_18px_55px_rgba(15,23,42,0.18)] sm:p-8">
            <div className="mb-7">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-300">02 / Access layer</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight">Multi-center queue registry</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Reserve your position across several centers. The first successful settlement clears the rest.
              </p>
            </div>
            <form onSubmit={handleQueueRegistration}>
              <label className="mb-5 block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Farmer identity</span>
                <input
                  value={farmerId}
                  onChange={(event) => setFarmerId(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-lime-300"
                />
              </label>
              <div className="space-y-3">
                {CENTERS.map((center) => (
                  <label
                    key={center.id}
                    className={`flex cursor-pointer items-center justify-between rounded-2xl border p-4 transition ${selectedCenters.includes(center.id) ? 'border-lime-300 bg-lime-300/10' : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'}`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedCenters.includes(center.id)}
                        onChange={() => toggleCenter(center.id)}
                        className="h-4 w-4 accent-lime-400"
                      />
                      <span>
                        <span className="block text-sm font-bold">{center.name}</span>
                        <span className="mt-1 block text-xs text-slate-400">
                          {center.distanceKm} km · {center.capacity}
                        </span>
                      </span>
                    </span>
                    <span className={`hidden rounded-full px-2 py-1 text-[10px] font-bold sm:block ${center.capacityTone}`}>CAPACITY</span>
                  </label>
                ))}
              </div>
              <button
                disabled={queueLoading}
                className="mt-5 w-full rounded-xl bg-lime-300 px-5 py-3.5 text-sm font-black text-slate-950 transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-60"
              >
                {queueLoading ? 'Registering queues...' : 'Apply to selected centers →'}
              </button>
            </form>
          </div>
        </section>

        {registrations.length > 0 && (
          <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">03 / Live registry</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight">Your active queue positions</h2>
              </div>
              <button
                onClick={handleCompleteTransaction}
                disabled={completeLoading}
                className="rounded-xl bg-rose-600 px-4 py-3 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {completeLoading ? 'Settling...' : 'Simulate Procurement Completion at Selected Center'}
              </button>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              {registrations.map((registration) => (
                <div key={registration.centerId} className="rounded-2xl border border-slate-200 p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-bold">{registration.centerName}</h3>
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">ACTIVE</span>
                  </div>
                  <div className="mb-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Queue position</p>
                      <p className="mt-1 text-3xl font-black text-slate-950">#{registration.queueIndex}</p>
                    </div>
                    <div className="rounded-xl bg-amber-50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Capacity wait index</p>
                      <p className="mt-1 text-3xl font-black text-amber-700">{registration.estimatedWaitTimeIndex}</p>
                    </div>
                  </div>
                  <QueueToken registration={registration} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
