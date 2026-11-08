'use client'
import { useState } from 'react'
import AppHeader from '@/components/AppHeader'
import CashFlowChart from '@/components/cash-flow-chart'
import LiveDataProvider, { useLiveData } from '@/components/live-data-provider'
import { asOfDate } from '@/lib/live-data'
import { historicalCushion, type CashFlowSelection } from '@/lib/historical-cushion'
import '../home/dashboard.css'
import '../life-cycle/life-cycle.css'
import './past.css'

export default function PastPage(){return <LiveDataProvider><PastInner /></LiveDataProvider>}
function PastInner(){
 const {customerId}=useLiveData();
 return <PastContent key={customerId} />;
}
function PastContent(){
 const {data,error}=useLiveData();
 const [hovered,setHovered]=useState<CashFlowSelection|null>(null);
 const [locked,setLocked]=useState<CashFlowSelection|null>(null);
 const asOf=data?asOfDate(data):'';
 const latest=(data?.timeline_360??[]).filter(point=>point.day_offset<=0&&point.actual_net_cash_cents!=null&&point.date<=asOf).sort((a,b)=>b.date.localeCompare(a.date))[0]?.date??asOf;
 const selection=locked??hovered;
 const date=selection?.date??latest;
 const months=historicalCushion(data,date);
 const width=months==null?0:Math.max(0,Math.min(100,months/6*100));
 const score=months==null?null:Math.max(1,Math.min(100,Math.round(width)));
 return <div className="life-cycle-page"><AppHeader current="past" /><main className="life-cycle-main"><div className="mb-6"><h1>180&deg; Past</h1></div>{error&&<p className="mb-4 text-sm text-red-700" role="alert">Can’t load live data: {error}</p>}<div className="pnc-dash past-cash-flow"><CashFlowChart selection={selection} locked={locked!==null} onPreview={setHovered} onLock={next=>{setLocked(next);setHovered(null);}} /></div><section className="health-panel past-cushion" aria-labelledby="cushion-heading"><div className="past-cushion-top"><h2 id="cushion-heading">Financial health</h2></div><div className="past-cushion-value" aria-live="polite" aria-atomic="true"><strong>{score==null?'Not available':score}</strong>{score!==null&&<span>/ 100</span>}</div><div className="past-cushion-track" role="meter" aria-label="Cash-based financial health score" aria-valuemin={1} aria-valuemax={100} aria-valuenow={score??undefined} aria-valuetext={score==null?'Not available':`${score} out of 100`}><div style={{width:`${width}%`}} /><span className="past-cushion-marker" style={{left:`${width}%`}} /></div><div className="past-cushion-scale"><span>1</span><span>25</span><span>50</span><span>75</span><span>100</span></div></section></main></div>;
}
