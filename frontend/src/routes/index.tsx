import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/')({
  component: App,
})

function App() {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [supabaseLoading, setSupabaseLoading] = useState(false)
  const [supabaseMessage, setSupabaseMessage] = useState('')

  const fetchMessage = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/hello')
      const data = await response.json()
      setMessage(data.message)
    } catch (error) {
      console.error('Error fetching message:', error)
      setMessage('Error: Could not fetch message')
    } finally {
      setLoading(false)
    }
  }

  const insertRandomNumber = async () => {
    setSupabaseLoading(true)
    setSupabaseMessage('')
    try {
      const response = await fetch('/api/supabase-random', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      const data = await response.json()
      if (data.success) {
        setSupabaseMessage(`✅ ${data.message} (ID: ${data.id || 'N/A'})`)
      } else {
        setSupabaseMessage(`❌ Error: ${data.error}`)
      }
    } catch (error) {
      console.error('Error inserting random number:', error)
      setSupabaseMessage('❌ Error: Could not insert random number')
    } finally {
      setSupabaseLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        <h1 className="text-2xl font-bold text-center">Motia Hello App</h1>
        
        <div className="flex justify-center">
          <Link to="/flights">
            <Button variant="outline">Search Flights</Button>
          </Link>
        </div>
        
        {/* Hello Message Section */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button onClick={fetchMessage} disabled={loading}>
              {loading ? 'Loading...' : 'Fetch Hello Message'}
            </Button>
          </div>
          <Input
            type="text"
            value={message}
            readOnly
            placeholder="Message will appear here..."
            className="w-full"
          />
        </div>

        {/* Supabase Random Number Section */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button onClick={insertRandomNumber} disabled={supabaseLoading}>
              {supabaseLoading ? 'Inserting...' : 'Insert Random Number to Supabase'}
            </Button>
          </div>
          <Input
            type="text"
            value={supabaseMessage}
            readOnly
            placeholder="Supabase result will appear here..."
            className="w-full"
          />
        </div>
      </div>
    </div>
  )
}
