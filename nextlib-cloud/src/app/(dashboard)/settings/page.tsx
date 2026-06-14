import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Pengaturan platform NextLib-Cloud
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Platform Version</p>
            <p className="text-sm text-muted-foreground">1.0.0 (Sprint 1)</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Environment</p>
            <p className="text-sm text-muted-foreground">Development</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
