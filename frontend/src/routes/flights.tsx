import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { z } from 'zod'

const flightsSearchSchema = z.object({
  origin: z.string().optional(),
  destination: z.string().optional(),
  departureDate: z.string().optional(),
  returnDate: z.string().optional(),
  isRoundTrip: z.union([z.string(), z.boolean()]).optional().transform((val) => {
    if (typeof val === 'boolean') return val
    return val === 'true'
  }),
  page: z.union([z.string(), z.number()]).optional().transform((val) => {
    if (!val) return 1
    const num = typeof val === 'number' ? val : parseInt(val, 10)
    return isNaN(num) || num < 1 ? 1 : num
  }),
})

export const Route = createFileRoute('/flights')({
  component: FlightsPage,
  validateSearch: flightsSearchSchema,
})

interface Flight {
  id: string
  flightNumber: string
  airline: string
  origin: string
  destination: string
  departureDate: string
  departureTime: string
  arrivalDate: string
  arrivalTime: string
  duration: number
}

interface Leg {
  id: string
  inbound: boolean
  connectionTime: number | null
  flight: Flight
}

interface TripWithDeals {
  tripId: string
  origin: string
  destination: string
  stopCount: number
  duration: number
  isRound: boolean
  departureDate: string
  departureTime: string
  returnDate: string | null
  returnTime: string | null
  legs: Leg[]
  deals: Array<{
    id: string
    source: string
    provider: string
    price: number
    link: string
    expiryDate: string
  }>
}

function FlightsPage() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  
  // Use URL params as source of truth
  const origin = search.origin || ''
  const destination = search.destination || ''
  const departureDate = search.departureDate || ''
  const returnDate = search.returnDate || ''
  const isRoundTrip = search.isRoundTrip || false
  const currentPage = search.page || 1
  const itemsPerPage = 10
  
  const [loading, setLoading] = useState(false)
  const [searchingLoading, setSearchingLoading] = useState(false)
  const [tripsWithDeals, setTripsWithDeals] = useState<TripWithDeals[]>([])
  const [error, setError] = useState('')
  const [selectedTripForDeals, setSelectedTripForDeals] = useState<TripWithDeals | null>(null)
  const [clearing, setClearing] = useState(false)
  const lastSearchedParams = useRef<string>('')

  // Calculate pagination
  const totalPages = Math.ceil(tripsWithDeals.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedTrips = tripsWithDeals.slice(startIndex, endIndex)

  // Reset to page 1 when search params change (but not when just page changes)
  const prevSearchKey = useRef<string>('')
  useEffect(() => {
    const searchKey = `${origin}|${destination}|${departureDate}|${returnDate}|${isRoundTrip}`
    if (searchKey !== prevSearchKey.current && prevSearchKey.current !== '') {
      // Search params changed, reset to page 1
      if (currentPage !== 1) {
        navigate({
          search: (prev) => ({
            ...prev,
            page: undefined, // Remove page param (defaults to 1)
          }),
          replace: true,
        })
      }
    }
    prevSearchKey.current = searchKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, departureDate, returnDate, isRoundTrip])

  const setPage = (page: number) => {
    updateSearchParams({ page: page.toString() })
  }

  // Pagination controls component
  const PaginationControls = () => {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-gray-600">
          Showing {startIndex + 1}-{Math.min(endIndex, tripsWithDeals.length)} of {tripsWithDeals.length}
        </div>
        
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
                // Show first page, last page, current page, and pages around current
                const showPage = 
                  pageNum === 1 ||
                  pageNum === totalPages ||
                  (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
                
                if (!showPage) {
                  // Show ellipsis
                  if (pageNum === currentPage - 2 || pageNum === currentPage + 2) {
                    return <span key={pageNum} className="px-2">...</span>
                  }
                  return null
                }
                
                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPage(pageNum)}
                    className="min-w-10"
                  >
                    {pageNum}
                  </Button>
                )
              })}
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    )
  }

  // Update URL when form values change
  const updateSearchParams = (updates: {
    origin?: string
    destination?: string
    departureDate?: string
    returnDate?: string
    isRoundTrip?: boolean
    page?: string | number
  }) => {
    navigate({
      search: (prev) => {
        const newSearch: any = {
          ...prev,
          ...updates,
        }
        // Serialize isRoundTrip as string for URL
        if (updates.isRoundTrip !== undefined) {
          newSearch.isRoundTrip = updates.isRoundTrip ? 'true' : undefined
        }
        // Remove returnDate if not round trip
        if (updates.isRoundTrip === false) {
          newSearch.returnDate = undefined
        } else if (updates.returnDate !== undefined) {
          newSearch.returnDate = updates.returnDate
        }
        // Handle page parameter
        if (updates.page !== undefined) {
          newSearch.page = updates.page === 1 ? undefined : updates.page.toString()
        }
        return newSearch
      },
      replace: true,
    })
  }

  const setOrigin = (value: string) => updateSearchParams({ origin: value })
  const setDestination = (value: string) => updateSearchParams({ destination: value })
  const setDepartureDate = (value: string) => updateSearchParams({ departureDate: value })
  const setReturnDate = (value: string) => updateSearchParams({ returnDate: value })
  const setIsRoundTrip = (value: boolean) => {
    updateSearchParams({ 
      isRoundTrip: value,
      returnDate: value ? returnDate : undefined,
    })
  }

  // Validate search parameters
  const validateSearchParams = (): string | null => {
    if (!origin || origin.length < 3) {
      return 'Origin must be at least 3 characters'
    }
    if (!destination || destination.length < 3) {
      return 'Destination must be at least 3 characters'
    }
    if (!departureDate) {
      return 'Departure date is required'
    }
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(departureDate)) {
      return 'Departure date must be in YYYY-MM-DD format'
    }
    // If round trip, validate return date
    if (isRoundTrip) {
      if (!returnDate) {
        return 'Return date is required for round trips'
      }
      if (!dateRegex.test(returnDate)) {
        return 'Return date must be in YYYY-MM-DD format'
      }
      // Validate return date is after departure date
      if (new Date(returnDate) < new Date(departureDate)) {
        return 'Return date must be after departure date'
      }
    }
    return null
  }

  // Auto-search when URL params are present, valid, and have changed
  useEffect(() => {
    // Create a key from the search params
    const searchKey = `${origin}|${destination}|${departureDate}|${returnDate}|${isRoundTrip}`
    
    // Validate before attempting to search
    const validationError = validateSearchParams()
    if (validationError) {
      lastSearchedParams.current = ''
      if (origin || destination || departureDate) {
        // Only set error if user has started filling the form
        setError(validationError)
      }
      return
    }
    
    // Clear any previous errors if validation passes
    setError('')
    
    // Only search if:
    // 1. Validation passed
    // 2. The params have changed from the last search
    // 3. We're not currently loading (full fetch) or searching (database query)
    const shouldAutoSearch = 
      searchKey !== lastSearchedParams.current &&
      !loading &&
      !searchingLoading

    if (shouldAutoSearch) {
      lastSearchedParams.current = searchKey
      handleSearchOnly()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, departureDate, returnDate, isRoundTrip, loading, searchingLoading])

  // Search only (query database, no scraping)
  const handleSearchOnly = async () => {
    // Validate before querying
    const validationError = validateSearchParams()
    if (validationError) {
      setError(validationError)
      return
    }

    setSearchingLoading(true)
    setError('')

    try {
      const requestBody: any = {
        origin,
        destination,
        departureDate,
      }

      if (isRoundTrip && returnDate) {
        requestBody.returnDate = returnDate
      }

      // Fetch the results from the database
      const searchResponse = await fetch('/api/flights/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const searchData = await searchResponse.json()

      if (searchData.success) {
        setTripsWithDeals(searchData.tripsWithDeals || [])
      } else {
        setError(searchData.error || 'Failed to fetch flights')
      }
    } catch (err) {
      console.error('Error searching flights:', err)
      setError('Failed to search flights. Please try again.')
    } finally {
      setSearchingLoading(false)
    }
  }

  // Full search with scraping (when user clicks button)
  const handleSearch = async () => {
    // Validate before fetching
    const validationError = validateSearchParams()
    if (validationError) {
      setError(validationError)
      return
    }

    // Update the last searched params
    const searchKey = `${origin}|${destination}|${departureDate}|${returnDate}|${isRoundTrip}`
    lastSearchedParams.current = searchKey

    setLoading(true)
    setError('')
    setTripsWithDeals([])

    try {
      const requestBody: any = {
        origin,
        destination,
        departureDate,
      }

      if (isRoundTrip && returnDate) {
        requestBody.returnDate = returnDate
      }

      // First, call the scraper endpoint to scrape flights from Skyscanner
      const scrapeResponse = await fetch('/api/flights/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const scrapeData = await scrapeResponse.json()

      if (!scrapeData.success) {
        setError(scrapeData.error || 'Failed to scrape flights')
        return
      }

      // After scraping, fetch the results from the database
      const searchResponse = await fetch('/api/flights/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const searchData = await searchResponse.json()

      if (searchData.success) {
        setTripsWithDeals(searchData.tripsWithDeals || [])
      } else {
        setError(searchData.error || 'Failed to fetch flights')
      }
    } catch (err) {
      console.error('Error searching flights:', err)
      setError('Failed to search flights. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    })
  }

  const formatTime = (timeString: string) => {
    // Remove seconds if present (format: HH:MM:SS -> HH:MM)
    if (timeString && timeString.includes(':')) {
      const parts = timeString.split(':')
      return `${parts[0]}:${parts[1]}`
    }
    return timeString
  }

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }

  const handleClearTables = async () => {
    if (!confirm('Are you sure you want to clear all flight data from the database? This action cannot be undone.')) {
      return
    }

    setClearing(true)
    setError('')

    try {
      const response = await fetch('/api/flights/clear', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      const data = await response.json()

      if (data.success) {
        setTripsWithDeals([])
        alert(`Tables cleared successfully!\n\nDeleted:\n- ${data.deleted.deals} deals\n- ${data.deleted.legs} legs\n- ${data.deleted.trips} trips\n- ${data.deleted.flights} flights`)
      } else {
        setError(data.error || 'Failed to clear tables')
      }
    } catch (err) {
      console.error('Error clearing tables:', err)
      setError('Failed to clear tables. Please try again.')
    } finally {
      setClearing(false)
    }
  }

  const TripCard = ({ trip }: { trip: TripWithDeals }) => {
    const [outboundOpen, setOutboundOpen] = useState(false)
    const [returnOpen, setReturnOpen] = useState(false)
    
    const minPrice = Math.min(...trip.deals.map(d => d.price))
    const outboundLegs = trip.legs.filter(leg => !leg.inbound)
    const returnLegs = trip.legs.filter(leg => leg.inbound)

    return (
      <div className="border rounded-lg p-4 hover:shadow-lg transition-shadow bg-white">
        {/* Header with trip info */}
        <div className="mb-3 pb-3 border-b">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="text-base font-semibold">
                {trip.isRound ? (
                  <>{trip.origin} ⇄ {trip.destination}</>
                ) : (
                  <>{trip.origin} → {trip.destination}</>
                )}
              </div>
              <div className="text-xs text-gray-500">
                {trip.stopCount === 0 ? 'Direct' : `${trip.stopCount} stop${trip.stopCount > 1 ? 's' : ''}`}
              </div>
            </div>
            <div className="text-right">
              <button
                onClick={() => setSelectedTripForDeals(trip)}
                className="text-xl font-bold text-green-600 hover:text-green-700 cursor-pointer transition-colors"
              >
                ${minPrice}
              </button>
              <div className="text-xs text-gray-500 cursor-pointer hover:text-gray-700" onClick={() => setSelectedTripForDeals(trip)}>
                {trip.deals.length} deal{trip.deals.length > 1 ? 's' : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Outbound Legs */}
        {outboundLegs.length > 0 && (
          <div className="mb-3">
            {(() => {
              const outboundDuration = outboundLegs.reduce((total, leg) => total + leg.flight.duration, 0) +
                outboundLegs.reduce((total, leg) => total + (leg.connectionTime || 0), 0);
              const firstOutboundLeg = outboundLegs[0];
              return (
                <button
                  onClick={() => setOutboundOpen(!outboundOpen)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 hover:text-gray-900 transition-colors"
                >
                  <span>
                    Outbound • <span className="text-blue-600">{formatDate(firstOutboundLeg.flight.departureDate)}</span> <span className="text-purple-600">{formatTime(firstOutboundLeg.flight.departureTime)}</span> • <span className="text-orange-600">{formatDuration(outboundDuration)}</span>
                  </span>
                  <span className="text-gray-400 text-xs">{outboundOpen ? '▼' : '▶'}</span>
                </button>
              );
            })()}
            {outboundOpen && (
              <div className="space-y-2">
                {outboundLegs.map((leg, idx) => (
                  <div key={leg.id} className="pl-3 border-l-2 border-blue-200">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-xs font-semibold">{leg.flight.airline}</div>
                      <div className="text-xs text-gray-500">{leg.flight.flightNumber}</div>
                      <div className="text-xs text-orange-600">
                        {formatDuration(leg.flight.duration)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold text-purple-600">{formatTime(leg.flight.departureTime)}</span>
                        <span className="text-gray-600">{leg.flight.origin}</span>
                      </div>
                      <span className="text-gray-400">→</span>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold text-purple-600">{formatTime(leg.flight.arrivalTime)}</span>
                        <span className="text-gray-600">{leg.flight.destination}</span>
                      </div>
                    </div>
                    {leg.connectionTime !== null && idx < outboundLegs.length - 1 && (
                      <div className="mt-1 text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded inline-block">
                        Wait: {Math.floor(leg.connectionTime / 60)}h {leg.connectionTime % 60}m at {leg.flight.destination}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Return Legs */}
        {returnLegs.length > 0 && (
          <div className="mb-3">
            {(() => {
              const returnDuration = returnLegs.reduce((total, leg) => total + leg.flight.duration, 0) +
                returnLegs.reduce((total, leg) => total + (leg.connectionTime || 0), 0);
              const firstReturnLeg = returnLegs[0];
              return (
                <button
                  onClick={() => setReturnOpen(!returnOpen)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 hover:text-gray-900 transition-colors"
                >
                  <span>
                    Return • <span className="text-blue-600">{formatDate(firstReturnLeg.flight.departureDate)}</span> <span className="text-purple-600">{formatTime(firstReturnLeg.flight.departureTime)}</span> • <span className="text-orange-600">{formatDuration(returnDuration)}</span>
                  </span>
                  <span className="text-gray-400 text-xs">{returnOpen ? '▼' : '▶'}</span>
                </button>
              );
            })()}
            {returnOpen && (
              <div className="space-y-2">
                {returnLegs.map((leg, idx) => (
                  <div key={leg.id} className="pl-3 border-l-2 border-green-200">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-xs font-semibold">{leg.flight.airline}</div>
                      <div className="text-xs text-gray-500">{leg.flight.flightNumber}</div>
                      <div className="text-xs text-orange-600">
                        {formatDuration(leg.flight.duration)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold text-purple-600">{formatTime(leg.flight.departureTime)}</span>
                        <span className="text-gray-600">{leg.flight.origin}</span>
                      </div>
                      <span className="text-gray-400">→</span>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold text-purple-600">{formatTime(leg.flight.arrivalTime)}</span>
                        <span className="text-gray-600">{leg.flight.destination}</span>
                      </div>
                    </div>
                    {leg.connectionTime !== null && idx < returnLegs.length - 1 && (
                      <div className="mt-1 text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded inline-block">
                        Wait: {Math.floor(leg.connectionTime / 60)}h {leg.connectionTime % 60}m at {leg.flight.destination}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Flight Search</h1>
          <Button 
            onClick={handleClearTables} 
            disabled={loading || clearing}
            variant="destructive"
            size="sm"
          >
            {clearing ? 'Clearing...' : 'Clear Data'}
          </Button>
        </div>
        
        {/* Search Form */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Origin</label>
              <Input
                type="text"
                placeholder="e.g., JFK"
                value={origin}
                onChange={(e) => setOrigin(e.target.value.toUpperCase())}
                maxLength={3}
                className="uppercase"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Destination</label>
              <Input
                type="text"
                placeholder="e.g., LAX"
                value={destination}
                onChange={(e) => setDestination(e.target.value.toUpperCase())}
                maxLength={3}
                className="uppercase"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Departure Date</label>
              <Input
                type="date"
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Return Date (Optional)</label>
              <Input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                min={departureDate || new Date().toISOString().split('T')[0]}
                disabled={!isRoundTrip}
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isRoundTrip}
                onChange={(e) => {
                  setIsRoundTrip(e.target.checked)
                  if (!e.target.checked) {
                    setReturnDate('')
                  }
                }}
                className="w-4 h-4"
              />
              <span className="text-sm">Round trip</span>
            </label>
          </div>
          
          <Button 
            onClick={handleSearch} 
            disabled={loading || clearing}
            className="w-full md:w-auto"
          >
            {loading ? 'Fetching...' : 'Fetch'}
          </Button>
          
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {searchingLoading && (
          <div className="text-center text-gray-500 py-12">
            <div className="flex items-center justify-center gap-1 mb-4">
              <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <div>Loading results...</div>
          </div>
        )}

        {!searchingLoading && tripsWithDeals.length > 0 && (
          <div>
            {/* Pagination Controls - Top */}
            <div className="mb-3">
              <PaginationControls />
            </div>
            
            <div className="space-y-3">
              {paginatedTrips.map((trip) => (
                <TripCard key={trip.tripId} trip={trip} />
              ))}
            </div>
            
            {/* Pagination Controls - Bottom */}
            <div className="mt-4">
              <PaginationControls />
            </div>
          </div>
        )}

        {!loading && !searchingLoading && tripsWithDeals.length === 0 && !error && (
          <div className="text-center text-gray-500 py-12">
            Enter your search criteria and click "Fetch" to see results
          </div>
        )}

        {/* Deals Popup Modal */}
        {selectedTripForDeals && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold">Available Deals</h2>
                  <div className="text-sm text-gray-600">
                    {selectedTripForDeals.isRound ? (
                      <>{selectedTripForDeals.origin} ⇄ {selectedTripForDeals.destination}</>
                    ) : (
                      <>{selectedTripForDeals.origin} → {selectedTripForDeals.destination}</>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedTripForDeals(null)}
                >
                  ✕
                </Button>
              </div>
              
              <div className="p-4">
                <div className="space-y-2">
                  {selectedTripForDeals.deals.map((deal) => {
                    const minPrice = Math.min(...selectedTripForDeals.deals.map(d => d.price))
                    
                    return (
                      <div key={deal.id} className="border rounded p-3 hover:shadow-sm transition-shadow">
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="font-semibold">{deal.provider}</div>
                              <div className="text-xs text-gray-500">• {deal.source}</div>
                              {deal.price === minPrice && (
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Best</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-xl font-bold text-green-600">${deal.price}</div>
                            </div>
                            <a
                              href={deal.link}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Button size="sm" variant="default">
                                View Deal
                              </Button>
                            </a>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
