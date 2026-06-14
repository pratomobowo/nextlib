import { TenantRegistrationForm } from './tenant-registration-form'

export const metadata = {
  title: 'Register New Tenant - NextLib Cloud',
  description: 'Register a new library tenant on NextLib Cloud platform',
}

export default function NewTenantPage() {
  return (
    <main className="flex min-h-screen items-start justify-center px-4 py-12">
      <TenantRegistrationForm />
    </main>
  )
}
