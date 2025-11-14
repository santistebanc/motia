import { useState } from 'react'
import type { TripWithDeals } from '@/types/flights'
import { formatDate, formatTime, formatDuration } from '@/utils/flight-utils'

interface TripCardProps {
  trip: TripWithDeals
  onSelectForDeals: (trip: TripWithDeals) => void
}

export function TripCard({ trip, onSelectForDeals }: TripCardProps) {
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
              onClick={() => onSelectForDeals(trip)}
              className="text-xl font-bold text-green-600 hover:text-green-700 cursor-pointer transition-colors"
            >
              ${minPrice}
            </button>
            <div className="text-xs text-gray-500 cursor-pointer hover:text-gray-700" onClick={() => onSelectForDeals(trip)}>
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

