"use client"

import * as React from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { BarChart3, Trophy, BookX, Library, Activity } from "lucide-react"
import { TopBooksPanel } from "./top-books-panel"
import { DeadStockPanel } from "./dead-stock-panel"
import { CollectionPanel } from "./collection-panel"
import { ActivityPanel } from "./activity-panel"

export interface AnalyticsTabsProps {
  tenants: { id: string; name: string }[]
  /** Pre-rendered Overview panel (server-rendered Suspense boundary). */
  overviewPanel: React.ReactNode
}

/**
 * Client-side tab shell for the analytics page. The Overview tab keeps the
 * existing AnalyticsPanel (visitor/loan/return trends from daily_stats).
 * The four detail tabs lazy-load their data from the agent via the cloud
 * analytics routes.
 */
export function AnalyticsTabs({ tenants, overviewPanel }: AnalyticsTabsProps) {
  const [tab, setTab] = React.useState("overview")

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="w-fit overflow-x-auto">
        <TabsTrigger value="overview">
          <BarChart3 className="h-4 w-4 mr-1" />
          Overview
        </TabsTrigger>
        <TabsTrigger value="top-books">
          <Trophy className="h-4 w-4 mr-1" />
          Buku Terlaris
        </TabsTrigger>
        <TabsTrigger value="dead-stock">
          <BookX className="h-4 w-4 mr-1" />
          Dead Stock
        </TabsTrigger>
        <TabsTrigger value="collection">
          <Library className="h-4 w-4 mr-1" />
          Koleksi
        </TabsTrigger>
        <TabsTrigger value="activity">
          <Activity className="h-4 w-4 mr-1" />
          Aktivitas
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-4">
        {overviewPanel}
      </TabsContent>
      <TabsContent value="top-books" className="mt-4">
        {/* Only render when active to defer the fetch until the tab opens */}
        {tab === "top-books" && <TopBooksPanel />}
      </TabsContent>
      <TabsContent value="dead-stock" className="mt-4">
        {tab === "dead-stock" && <DeadStockPanel />}
      </TabsContent>
      <TabsContent value="collection" className="mt-4">
        {tab === "collection" && <CollectionPanel />}
      </TabsContent>
      <TabsContent value="activity" className="mt-4">
        {tab === "activity" && <ActivityPanel />}
      </TabsContent>
    </Tabs>
  )
}
