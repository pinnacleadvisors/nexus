import { redirect } from 'next/navigation'

export default function ReusableCodePage() {
  // Library page defaults to the 'code' tab — this path is a friendly alias
  // for the sidebar's "Reusable code functions" entry.
  redirect('/tools/library')
}
