import { Button } from '@/components/ui/button'
import type { TripWithDeals } from '@/types/flights'

interface PaginationControlsProps {
  currentPage: number
  totalPages: number
  startIndex: number
  endIndex: number
  totalItems: number
  onPageChange: (page: number) => void
}

export function PaginationControls({ 
  currentPage, 
  totalPages, 
  startIndex, 
  endIndex, 
  totalItems,
  onPageChange 
}: PaginationControlsProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm text-gray-600">
        Showing {startIndex + 1}-{Math.min(endIndex, totalItems)} of {totalItems}
      </div>
      
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
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
                  onClick={() => onPageChange(pageNum)}
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
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

