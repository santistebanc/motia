import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { flightsSearchSchema } from '@/schemas/flights'
import type { TripWithDeals } from '@/types/flights'
import { TripCard } from '@/components/TripCard'
import { PaginationControls } from '@/components/PaginationControls'
import { DealsModal } from '@/components/DealsModal'
import { formatLastFetched } from '@/utils/flight-utils'

export const Route = createFileRoute('/flights')({
  component: FlightsPage,
  validateSearch: flightsSearchSchema,
})

function FlightsPage() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  
  // Use URL params as source of truth
  const origin = search.origin || ''
  const destination = search.destination || ''
  const departureDate = search.departureDate || ''
  const departureDateEnd = search.departureDateEnd || ''
  const returnDate = search.returnDate || ''
  const returnDateEnd = search.returnDateEnd || ''
  const isRoundTrip = search.isRoundTrip || false
  const currentPage = search.page || 1
  const itemsPerPage = 10
  
  // Range mode states
  const departureRangeMode = !!departureDateEnd
  const returnRangeMode = !!returnDateEnd
  
  const [loading, setLoading] = useState(false)
  const [searchingLoading, setSearchingLoading] = useState(false)
  const [tripsWithDeals, setTripsWithDeals] = useState<TripWithDeals[]>([])
  const [error, setError] = useState('')
  const [selectedTripForDeals, setSelectedTripForDeals] = useState<TripWithDeals | null>(null)
  const [clearing, setClearing] = useState(false)
  const [lastFetched, setLastFetched] = useState<string | null>(null)
  const lastSearchedParams = useRef<string>('')

  // Calculate pagination
  const totalPages = Math.ceil(tripsWithDeals.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedTrips = tripsWithDeals.slice(startIndex, endIndex)

  // Reset to page 1 when search params change (but not when just page changes)
  const prevSearchKey = useRef<string>('')
  useEffect(() => {
    const searchKey = `${origin}|${destination}|${departureDate}|${departureDateEnd}|${returnDate}|${returnDateEnd}|${isRoundTrip}`
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
  }, [origin, destination, departureDate, departureDateEnd, returnDate, returnDateEnd, isRoundTrip])

  const setPage = (page: number) => {
    updateSearchParams({ page: page.toString() })
  }

  // Generate all date combinations from ranges
  const generateDateCombinations = () => {
    const departureDates: string[] = []
    const returnDates: string[] = []
    
    // Generate departure dates
    if (departureDate) {
      if (departureRangeMode && departureDateEnd) {
        const start = new Date(departureDate)
        const end = new Date(departureDateEnd)
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          departureDates.push(d.toISOString().split('T')[0])
        }
      } else {
        departureDates.push(departureDate)
      }
    }
    
    // Generate return dates (only if round trip)
    if (isRoundTrip && returnDate) {
      if (returnRangeMode && returnDateEnd) {
        const start = new Date(returnDate)
        const end = new Date(returnDateEnd)
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          returnDates.push(d.toISOString().split('T')[0])
        }
      } else {
        returnDates.push(returnDate)
      }
    }
    
    // Generate all combinations
    const combinations: Array<{ departureDate: string; returnDate?: string }> = []
    for (const depDate of departureDates) {
      if (returnDates.length > 0) {
        for (const retDate of returnDates) {
          combinations.push({ departureDate: depDate, returnDate: retDate })
        }
      } else {
        combinations.push({ departureDate: depDate })
      }
    }
    
    return combinations
  }

  // Update URL when form values change
  const updateSearchParams = (updates: {
    origin?: string
    destination?: string
    departureDate?: string
    departureDateEnd?: string
    returnDate?: string
    returnDateEnd?: string
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
        // Remove returnDate and returnDateEnd if not round trip
        if (updates.isRoundTrip === false) {
          newSearch.returnDate = undefined
          newSearch.returnDateEnd = undefined
        } else {
          if (updates.returnDate !== undefined) {
            newSearch.returnDate = updates.returnDate
          }
          if (updates.returnDateEnd !== undefined) {
            newSearch.returnDateEnd = updates.returnDateEnd
          }
        }
        // Handle departureDateEnd
        if (updates.departureDateEnd !== undefined) {
          newSearch.departureDateEnd = updates.departureDateEnd || undefined
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
  const setDepartureDateEnd = (value: string) => updateSearchParams({ departureDateEnd: value })
  const setReturnDate = (value: string) => updateSearchParams({ returnDate: value })
  const setReturnDateEnd = (value: string) => updateSearchParams({ returnDateEnd: value })
  const setIsRoundTrip = (value: boolean) => {
    updateSearchParams({ 
      isRoundTrip: value,
      returnDate: value ? returnDate : undefined,
      returnDateEnd: value ? returnDateEnd : undefined,
    })
  }
  const setDepartureRangeMode = (enabled: boolean) => {
    if (enabled) {
      // Enable range mode - set end date to start date if not set
      updateSearchParams({ departureDateEnd: departureDateEnd || departureDate })
    } else {
      // Disable range mode - remove end date
      updateSearchParams({ departureDateEnd: undefined })
    }
  }
  const setReturnRangeMode = (enabled: boolean) => {
    if (!isRoundTrip) return // Don't allow enabling if round trip is not selected
    
    if (enabled) {
      // Enable range mode - set end date to start date if not set, or use a default
      const endDate = returnDateEnd || returnDate || departureDate || new Date().toISOString().split('T')[0]
      updateSearchParams({ returnDateEnd: endDate })
    } else {
      // Disable range mode - remove end date
      updateSearchParams({ returnDateEnd: undefined })
    }
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
    // Validate departure date range
    if (departureRangeMode) {
      if (!departureDateEnd) {
        return 'Departure end date is required when range mode is enabled'
      }
      if (!dateRegex.test(departureDateEnd)) {
        return 'Departure end date must be in YYYY-MM-DD format'
      }
      if (new Date(departureDateEnd) < new Date(departureDate)) {
        return 'Departure end date must be after start date'
      }
    }
    // If round trip, validate return date
    if (isRoundTrip) {
      if (!returnDate) {
        return 'Return date is required for round trips'
      }
      if (!dateRegex.test(returnDate)) {
        return 'Return date must be in YYYY-MM-DD format'
      }
      // Validate return date range
      if (returnRangeMode) {
        if (!returnDateEnd) {
          return 'Return end date is required when range mode is enabled'
        }
        if (!dateRegex.test(returnDateEnd)) {
          return 'Return end date must be in YYYY-MM-DD format'
        }
        if (new Date(returnDateEnd) < new Date(returnDate)) {
          return 'Return end date must be after start date'
        }
      }
      // Validate return date is after departure date (check earliest departure vs earliest return)
      const earliestDeparture = departureDate
      const earliestReturn = returnDate
      if (new Date(earliestReturn) < new Date(earliestDeparture)) {
        return 'Return date must be after departure date'
      }
    }
    return null
  }

  // Auto-search when URL params are present, valid, and have changed
  useEffect(() => {
    // Create a key from the search params (include range dates)
    const searchKey = `${origin}|${destination}|${departureDate}|${departureDateEnd}|${returnDate}|${returnDateEnd}|${isRoundTrip}`
    
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
  }, [origin, destination, departureDate, departureDateEnd, returnDate, returnDateEnd, isRoundTrip, loading, searchingLoading])

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
      // Use range endpoint if ranges are enabled, otherwise use regular endpoint
      const useRangeEndpoint = departureRangeMode || returnRangeMode
      const endpoint = useRangeEndpoint ? '/api/flights/search-range' : '/api/flights/search'
      
      const requestBody: any = {
        origin,
        destination,
        departureDate,
      }

      if (departureRangeMode && departureDateEnd) {
        requestBody.departureDateEnd = departureDateEnd
      }

      if (isRoundTrip && returnDate) {
        requestBody.returnDate = returnDate
        if (returnRangeMode && returnDateEnd) {
          requestBody.returnDateEnd = returnDateEnd
        }
      }

      const searchResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const searchData = await searchResponse.json()

      if (searchData.success) {
        setTripsWithDeals(searchData.tripsWithDeals || [])
        setLastFetched(searchData.lastFetched || null)
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
    const searchKey = `${origin}|${destination}|${departureDate}|${departureDateEnd}|${returnDate}|${returnDateEnd}|${isRoundTrip}`
    lastSearchedParams.current = searchKey

    setLoading(true)
    setError('')
    setTripsWithDeals([])

    try {
      // Use range endpoint if ranges are enabled, otherwise use regular endpoint
      const useRangeEndpoint = departureRangeMode || returnRangeMode
      const scrapeEndpoint = useRangeEndpoint ? '/api/flights/scrape-range' : '/api/flights/scrape'
      const searchEndpoint = useRangeEndpoint ? '/api/flights/search-range' : '/api/flights/search'
      
      const requestBody: any = {
        origin,
        destination,
        departureDate,
      }

      if (departureRangeMode && departureDateEnd) {
        requestBody.departureDateEnd = departureDateEnd
      }

      if (isRoundTrip && returnDate) {
        requestBody.returnDate = returnDate
        if (returnRangeMode && returnDateEnd) {
          requestBody.returnDateEnd = returnDateEnd
        }
      }

      // First, call the scraper endpoint to scrape flights from Skyscanner
      const scrapeResponse = await fetch(scrapeEndpoint, {
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
      const searchResponse = await fetch(searchEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const searchData = await searchResponse.json()

      if (searchData.success) {
        setTripsWithDeals(searchData.tripsWithDeals || [])
        setLastFetched(searchData.lastFetched || null)
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
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="departure-range-checkbox"
                  checked={departureRangeMode}
                  onChange={(e) => setDepartureRangeMode(e.target.checked)}
                  className="w-4 h-4"
                />
                <label 
                  htmlFor="departure-range-checkbox"
                  className="block text-sm font-medium cursor-pointer"
                >
                  Departure Date{departureRangeMode ? ' Range' : ''}
                </label>
              </div>
              <div className="flex gap-2">
              <Input
                type="date"
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                  placeholder="Start"
                />
                {departureRangeMode && (
                  <Input
                    type="date"
                    value={departureDateEnd}
                    onChange={(e) => setDepartureDateEnd(e.target.value)}
                    min={departureDate || new Date().toISOString().split('T')[0]}
                    placeholder="End"
                  />
                )}
              </div>
            </div>
            
            <div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="return-range-checkbox"
                  checked={returnRangeMode}
                  onChange={(e) => {
                    if (isRoundTrip) {
                      setReturnRangeMode(e.target.checked)
                    }
                  }}
                  disabled={!isRoundTrip}
                  className="w-4 h-4"
                />
                <label 
                  htmlFor="return-range-checkbox"
                  className={`block text-sm font-medium ${isRoundTrip ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                  onClick={(e) => {
                    if (!isRoundTrip) {
                      e.preventDefault()
                    }
                  }}
                >
                  Return Date{returnRangeMode ? ' Range' : ''} {!isRoundTrip && '(Enable Round trip first)'}
                </label>
              </div>
              <div className="flex gap-2">
              <Input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                min={departureDate || new Date().toISOString().split('T')[0]}
                disabled={!isRoundTrip}
                  placeholder="Start"
                />
                {returnRangeMode && isRoundTrip && (
                  <Input
                    type="date"
                    value={returnDateEnd}
                    onChange={(e) => setReturnDateEnd(e.target.value)}
                    min={returnDate || departureDate || new Date().toISOString().split('T')[0]}
                    disabled={!isRoundTrip}
                    placeholder="End"
                  />
                )}
              </div>
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
          
          <div className="flex items-center gap-3">
          <Button 
            onClick={handleSearch} 
              disabled={loading || clearing}
            className="w-full md:w-auto"
          >
              {loading ? 'Fetching...' : 'Fetch'}
          </Button>
            {lastFetched && (
              <span className="text-xs text-gray-500">
                Last fetched: {formatLastFetched(lastFetched)}
              </span>
            )}
          </div>
          
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
              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                startIndex={startIndex}
                endIndex={endIndex}
                totalItems={tripsWithDeals.length}
                onPageChange={setPage}
              />
            </div>
            
            <div className="space-y-3">
              {paginatedTrips.map((trip) => (
                <TripCard 
                  key={trip.tripId} 
                  trip={trip}
                  onSelectForDeals={setSelectedTripForDeals}
                />
              ))}
            </div>
            
            {/* Pagination Controls - Bottom */}
            <div className="mt-4">
              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                startIndex={startIndex}
                endIndex={endIndex}
                totalItems={tripsWithDeals.length}
                onPageChange={setPage}
              />
            </div>
          </div>
        )}

        {!loading && !searchingLoading && tripsWithDeals.length === 0 && !error && (
          <div className="text-center text-gray-500 py-12">
            Enter your search criteria and click "Fetch" to see results
          </div>
        )}

        {/* Deals Modal */}
        {selectedTripForDeals && (
          <DealsModal
            trip={selectedTripForDeals}
            onClose={() => setSelectedTripForDeals(null)}
          />
        )}
      </div>
    </div>
  )
}
