import { Button } from '@/components/ui/button'
import type { TripWithDeals } from '@/types/flights'

interface DealsModalProps {
  trip: TripWithDeals
  onClose: () => void
}

export function DealsModal({ trip, onClose }: DealsModalProps) {
  const minPrice = Math.min(...trip.deals.map(d => d.price))
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">Available Deals</h2>
            <div className="text-sm text-gray-600">
              {trip.isRound ? (
                <>{trip.origin} ⇄ {trip.destination}</>
              ) : (
                <>{trip.origin} → {trip.destination}</>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            ✕
          </Button>
        </div>
        
        <div className="p-4">
          <div className="space-y-2">
            {trip.deals.map((deal) => (
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
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

