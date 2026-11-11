(function () {
  'use strict';
  const C = window.AeroCalc;
  const P = window.AeroPlots;
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  const clone = function (v) { return JSON.parse(JSON.stringify(v)); };
  const num = function (v, d) { return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', {minimumFractionDigits:d,maximumFractionDigits:d}) : 'Unavailable'; };
  const val = function (o, p) { return p.split('.').reduce(function (a, k) { return a == null ? null : a[k]; }, o); };
  const fieldKeys = ['caseId','mode','weightMode','W','m','geometryMode','S','AR','b','e','CD0','CLmax','h','supplyMode','Vlo','Vhi','Vop'];
  const state = {last:null,dirty:false,history:[],plot:'thrust',svg:'',baseline:null,studies:null};
  const studyDefinitions = {
    weight:{label:'Aircraft weight',unit:'N',factors:[.85,1,1.15],control:'Vary W; hold S, AR, e, CD0, CLmax, h and propulsion fixed.'},
    ar:{label:'Aspect ratio',unit:'dimensionless',factors:[.8,1,1.25],control:'Vary AR at fixed wing area; implied span changes. Hold other physical inputs fixed.'},
    supply:{label:'Available propulsion',unit:'',factors:[.85,1,1.15],control:'Vary the active useful-power or thrust input; hold atmosphere, weight and aerodynamics fixed.'},
    altitude:{label:'Geopotential altitude',unit:'m',control:'Vary h; hold geometry, weight and aerodynamic coefficients fixed. The selected propulsion interpretation remains active.'},
    wingLoading:{label:'Wing loading',unit:'N/m²',factors:[.85,1,1.15],control:'Vary wing area to change W/S while keeping weight and AR fixed. Implied span changes.'},
    cd0:{label:'Zero-lift drag coefficient',unit:'dimensionless',factors:[.85,1,1.15],control:'Vary CD0; hold every other physical input fixed.'}
  };
  function message(kind, title, items) {
    return '<div class="message '+kind+'"><strong>'+esc(title)+'</strong>'+(items && items.length ? '<ul>'+items.map(function (s) { return '<li>'+esc(s)+'</li>'; }).join('')+'</ul>' : '')+'</div>';
  }
  function activeFields() {
    $('weight-field').hidden = $('weightMode').value !== 'weight';
    $('mass-field').hidden = $('weightMode').value !== 'mass';
    $('ar-field').hidden = $('geometryMode').value !== 'ar';
    $('span-field').hidden = $('geometryMode').value !== 'span';
    $('power-field').hidden = $('mode').value !== 'propeller';
    $('thrust-field').hidden = $('mode').value !== 'jet';
  }
  function readInputs() {
    const r = {};
    fieldKeys.forEach(function (k) { r[k] = $(k).value; });
    r.supply = $(r.mode === 'propeller' ? 'power' : 'thrust').value;
    return r;
  }
  function setInputs(input) {
    fieldKeys.forEach(function (k) { if (input[k] != null) $(k).value = input[k]; });
    $(input.mode === 'propeller' ? 'power' : 'thrust').value = input.supply;
    activeFields();
  }
  function exportsEnabled(yes) {
    ['export-json','export-csv','export-svg'].forEach(function (id) { $(id).disabled = !yes; });
  }
  function dirty() {
    state.dirty = true;
    document.querySelector('.result-panel').classList.add('is-stale');
    $('run-status').className = 'status stale';
    $('run-status').textContent = 'Inputs changed';
    $('messages').innerHTML = message('info','Inputs changed. Press Calculate to update.',state.last ? ['Displayed results belong to the previous run: '+state.last.input.caseId+'.'] : []);
    exportsEnabled(false);
    activeFields();
  }
  function preset(id, execute) {
    setInputs(C.PRESETS[id]);
    if (execute) calculate(); else dirty();
  }
  function selectTab(name) {
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      const on = b.dataset.tab === name;
      b.classList.toggle('active',on); b.setAttribute('aria-selected',String(on)); b.tabIndex=on?0:-1;
      $('panel-'+b.dataset.tab).hidden = !on;
    });
  }
  function calculate() {
    const r = C.calculate(readInputs());
    if (!r.ok) {
      state.dirty = true;
      $('messages').innerHTML = message('error','Correct these inputs to calculate.',r.errors);
      $('run-status').className='status error'; $('run-status').textContent='Input error';
      document.querySelector('.result-panel').classList.add('is-stale');
      if (state.last) $('messages').innerHTML += message('info','The results below are from the previous run.',[state.last.input.caseId+' — they do not describe the invalid inputs.']);
      exportsEnabled(false);
      return r;
    }
    r.runTimestamp = new Date().toISOString();
    state.history.push(r);
    showResult(r);
    return r;
  }
  function showResult(r) {
    state.last=r; state.dirty=false;
    document.querySelector('.result-panel').classList.remove('is-stale');
    $('run-label').textContent=r.input.caseId+' · '+(r.input.mode==='propeller'?'Propeller':'Jet');
    $('run-status').className='status'; $('run-status').textContent='Calculated';
    $('messages').innerHTML=r.warnings.length ? '<div class="message"><details><summary>'+r.warnings.length+' model '+(r.warnings.length===1?'note':'notes')+' for this run</summary><ul>'+r.warnings.map(function(w){return '<li>'+esc(w)+'</li>';}).join('')+'</ul></details></div>' : '';
    if (r.model.domain.empty) $('messages').innerHTML += message('error','No supported unstalled level-flight interval.', ['The reference stall speed exceeds the model speed cap. Separate glide feasibility is evaluated with its own domain.']);
    renderOverview(r); renderOperating(r); renderPlot(); renderHistory(); renderSolver(r);
    exportsEnabled(true);
  }
  function metric(label, value, unit, detail, digits) {
    return '<div class="metric"><div class="metric-label">'+esc(label)+'</div><div class="metric-value">'+num(value,digits==null?3:digits)+(typeof value==='number'?'<span class="unit">'+esc(unit)+'</span>':'')+'</div><div class="metric-detail">'+detail+'</div></div>';
  }
  function datum(label,value,unit,digits) {
    return '<div class="datum"><span>'+esc(label)+'</span><strong>'+num(value,digits==null?3:digits)+(typeof value==='number'?' '+esc(unit):'')+'</strong></div>';
  }
  function renderOverview(r) {
    const s=r.summary,a=r.atmosphere,g=s.glide,range=s.sustainable;
    let rangeText='No supported steady-level-flight solution';
    if(range.exists) rangeText=range.tangent?'Single limiting equilibrium':(range.lo==null||range.hi==null?'Supported flight; an interval bound is unavailable':num(range.lo,3)+'–'+num(range.hi,3)+' m/s');
    const speedText=s.maxSpeed.value==null?'Unavailable':num(s.maxSpeed.value,3)+' <span>m/s</span>';
    let h='<div class="hero-result"><div><p class="eyebrow">SUSTAINABLE LEVEL-FLIGHT INTERVAL</p><h2>'+rangeText+'</h2><p>'+(range.exists?'Available supply can meet demand within the feasible interval, with supply reduced as required.':r.model.domain.empty?'The stall boundary and model speed cap leave no supported level-flight speed.':'Available propulsion cannot sustain a supported level-flight point for this case.')+(range.upperLimited?' The interval ends at the model cap; the propulsion-limited maximum lies beyond it.':'')+'</p></div><div class="hero-right"><span class="small">Maximum speed within model</span><div class="hero-speed">'+speedText+'</div></div></div>';
    h+='<div class="metric-grid">';
    h+=metric('Level-flight stall',s.stallSpeed,'m/s','Reference level-flight stall boundary.',3);
    h+=metric('Minimum thrust required',s.minThrust.value,'N','At '+num(s.minThrust.speed,3)+' m/s'+(s.minThrust.constrained?' · constrained':'')+(s.minThrust.propulsionSufficient===false?'<br>Insufficient propulsion at this condition.':''),2);
    h+=metric('Minimum power required',s.minPower.value==null?null:s.minPower.value/1000,'kW','At '+num(s.minPower.speed,3)+' m/s'+(s.minPower.constrained?' · constrained':'')+(s.minPower.propulsionSufficient===false?'<br>Insufficient propulsion at this condition.':''),3);
    h+=metric('Maximum estimated climb',s.maxRC,'m/s','At '+num(s.bestClimbSpeed,3)+' m/s'+(s.maxRC<0?'<br>No positive climb capability predicted.':'')+(s.maxExcessPower.climbValid===false?'<br>Outside the climb applicability screen.':''),3);
    h+=metric('Maximum excess power',s.maxExcessPower.value==null?null:s.maxExcessPower.value/1000,'kW','Level-flight-drag approximation; signed output.',3);
    h+=metric('Best supported glide ratio',g.ok?g.LD:null,': 1',g.ok?'At '+num(g.speed,3)+' m/s · '+num(g.angleDeg,3)+'°'+(g.constrained?' · constrained':''):'No supported steady-glide condition.',6);
    h+='</div><details class="detail-box"><summary>View Detailed Results</summary><section class="surface"><div class="section-heading"><div><p class="eyebrow">THEORY AND SUPPORTED CONDITIONS</p><h2>Characteristic values</h2></div></div><div class="table-scroll"><table><thead><tr><th>Quantity</th><th class="numeric">Unrestricted speed</th><th class="numeric">Supported speed</th><th class="numeric">Supported value</th></tr></thead><tbody>';
    h+='<tr><td>Minimum required thrust</td><td class="numeric">'+num(s.minThrust.unrestrictedSpeed,3)+' m/s</td><td class="numeric">'+num(s.minThrust.speed,3)+' m/s</td><td class="numeric">'+num(s.minThrust.value,2)+' N</td></tr>';
    h+='<tr><td>Minimum required power</td><td class="numeric">'+num(s.minPower.unrestrictedSpeed,3)+' m/s</td><td class="numeric">'+num(s.minPower.speed,3)+' m/s</td><td class="numeric">'+num(s.minPower.value==null?null:s.minPower.value/1000,3)+' kW</td></tr>';
    h+='<tr><td>Best level-flight L/D</td><td class="numeric">'+num(s.minThrust.unrestrictedSpeed,3)+' m/s</td><td class="numeric">'+num(s.maxLevelLD.speed,3)+' m/s</td><td class="numeric">'+num(s.maxLevelLD.value,6)+'</td></tr></tbody></table></div><p class="source-note">Unrestricted minima: '+num(s.minThrust.unrestrictedValue,2)+' N and '+num(s.minPower.unrestrictedValue/1000,3)+' kW. Unrestricted L/D: '+num(g.unrestrictedLD,6)+'. Supported aerodynamic optima still require sufficient propulsion for powered level flight.</p><p class="source-note">'+esc(s.maxSpeed.message)+'</p></section>';
    h+='<div class="split-grid"><section class="surface"><p class="eyebrow">STANDARD ATMOSPHERE</p><h2>Conditions at '+num(r.input.h,0)+' m</h2><div class="data-grid">';
    h+=datum('Density',a.rho,'kg/m³',6)+datum('Temperature',a.T,'K',3)+datum('Pressure',a.p,'Pa',2)+datum('Sound speed',a.soundSpeed,'m/s',3)+datum('Mach 0.30 cap',a.Vcap,'m/s',3)+datum('Induced factor K',r.model.K,'',6);
    h+='</div></section><section class="surface"><p class="eyebrow">BEST-RANGE STEADY GLIDE</p><h2>Separate glide force balance</h2><div class="data-grid">';
    h+=datum('True airspeed',g.ok?g.speed:null,'m/s')+datum('Glide angle',g.ok?g.angleDeg:null,'°')+datum('Sink rate',g.ok?g.sink:null,'m/s')+datum('Horizontal speed',g.ok?g.horizontalSpeed:null,'m/s')+datum('Lift coefficient',g.ok?g.CL:null,'',6)+datum('Drag coefficient',g.ok?g.CD:null,'',6);
    h+='</div><p class="source-note">Still air, zero thrust, fixed polar. This is the maximum-range condition; minimum sink is a different objective.</p></section></div></details>';
    $('overview').innerHTML=h;
  }
  function renderOperating(r) {
    const o=r.operating;
    $('operating-title').textContent='At '+num(o.V,3)+' m/s true airspeed';
    $('operating-tag').textContent=o.usable?(o.levelFeasible?'Supported · supply sufficient':'Supported · propulsion deficit'):'Mathematical value only';
    let h=o.flags.length?message('','Operating-point notes',o.flags):'';
    h+='<div class="data-grid">';
    h+=datum('Dynamic pressure',o.q,'Pa',2)+datum('Lift coefficient CL',o.CL,'',6)+datum('Drag coefficient CD',o.CD,'',6);
    h+=datum('Zero-lift drag',o.D0,'N',2)+datum('Induced drag',o.Di,'N',2)+datum('Total drag / thrust required',o.TR,'N',2);
    h+=datum('Available thrust',o.TA,'N',2)+datum('Required power',o.PR/1000,'kW')+datum('Available power',o.PA/1000,'kW');
    h+=datum('Excess thrust',o.excessThrust,'N',2)+datum('Excess power',o.excessPower/1000,'kW')+datum('Power deficit',o.powerDeficit/1000,'kW');
    h+=datum('Estimated climb rate',o.RC,'m/s')+datum('Mach number',o.mach,'',6)+datum('Estimated flight-path angle',o.angleDeg,'°');
    h+='</div><p class="source-note">Required and available values use useful propulsive power. A positive margin allows the supply to be reduced for level flight. Climb estimates use level-flight drag and retain their applicability flags.</p>';
    $('operating').innerHTML=h;
  }
  function plotMarkers(r) {
    const s=r.summary, m=[];
    function add(V,label) { if(typeof V==='number' && Number.isFinite(V)) m.push({V:V,label:label}); }
    if(state.plot==='thrust'||state.plot==='excessThrust') add(s.minThrust.speed,'Min thrust');
    if(state.plot==='power'||state.plot==='excessPower'||state.plot==='deficit') add(s.minPower.speed,'Min power');
    if(state.plot==='climb'||state.plot==='excessPower') add(s.bestClimbSpeed,'Max excess power');
    (r.solver.roots||[]).forEach(function(root){add(root.speed,root.kind==='low'?'Low equilibrium':root.kind==='tangent'?'Tangent':'High equilibrium');});
    add(r.input.Vop,'Operating point');
    return m;
  }
  function renderPlot() {
    if(!state.last) return;
    const r=state.last, markers=plotMarkers(r);
    state.svg=P.render({kind:state.plot,samples:r.curves.map(function(p){return Object.assign({},p,{valid:p.usable,deficit:p.powerDeficit});}),Vlo:r.input.Vlo,Vhi:r.input.Vhi,Vs:r.model.Vs,Vcap:r.atmosphere.Vcap,markers:markers,caseId:r.input.caseId});
    $('plot-container').innerHTML=state.svg;
    const all=[{V:r.model.Vs,label:'Level-flight stall'},{V:r.atmosphere.Vcap,label:'Mach 0.30 cap'}].concat(markers);
    $('plot-markers').innerHTML='<h3>Conditions and markers</h3><div class="table-scroll"><table><thead><tr><th>Condition</th><th class="numeric">Speed · m/s</th><th>Display status</th></tr></thead><tbody>'+all.map(function(m){return '<tr><td>'+esc(m.label)+'</td><td class="numeric">'+num(m.V,3)+'</td><td>'+(m.V<r.input.Vlo||m.V>r.input.Vhi?'Outside plotting window':'Within plotting window')+'</td></tr>';}).join('')+'</tbody></table></div>';
  }
  function renderHistory() {
    if(!state.history.length) { $('history').innerHTML='<p class="empty">Calculate a case to keep a run in this session.</p>'; return; }
    const rows=state.history.map(function(r,i){return '<tr><td>'+esc(r.input.caseId)+'</td><td>'+esc(r.input.mode)+'</td><td>'+num(r.input.h,0)+'</td><td>'+num(r.summary.maxSpeed.value,3)+'</td><td><button type="button" class="text-button" data-history="'+i+'">Inspect</button></td></tr>';}).reverse();
    $('history').innerHTML='<div class="table-scroll"><table><thead><tr><th>Case</th><th>Mode</th><th>Altitude · m</th><th>Vmax · m/s</th><th></th></tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
  }
  function renderSolver(r) {
    let h='<div class="chips"><span class="chip">501 curve samples</span><span class="chip">Root width ≤ 10⁻⁸ m/s</span><span class="chip">Power residual ≤ 10⁻⁵ W</span><span class="chip">Up to 200 iterations</span></div>';
    h+='<p class="source-note">Full level-flight solver interval: '+num(r.model.domain.lo,6)+'–'+num(r.model.domain.hi,6)+' m/s. Status: '+esc(r.solver.status)+'. The displayed plot interval does not change this search.</p>';
    if(r.solver.roots.length) h+='<div class="table-scroll"><table><thead><tr><th>Intersection</th><th>Unrounded speed · m/s</th><th>Residual · W</th><th>Iterations</th><th>Bracket width · m/s</th></tr></thead><tbody>'+r.solver.roots.map(function(x){return '<tr><td>'+esc(x.kind)+'</td><td>'+esc(x.speed.toPrecision(14))+'</td><td>'+esc(x.residual.toExponential(5))+'</td><td>'+esc(x.iterations)+'</td><td>'+esc((x.bracket[1]-x.bracket[0]).toExponential(5))+'</td></tr>';}).join('')+'</tbody></table></div>';
    if(r.solver.failures.length) h+=message('error','Numerical solver failure',r.solver.failures.map(function(f){return typeof f==='string'?f:(f.kind||'Intersection')+': '+(f.reason||'The solver did not converge.');}));
    $('solver-details').innerHTML=h;
  }
  function scalarRows(r) {
    const definitions=[
      ['density','atmosphere.rho','kg/m3'],['temperature','atmosphere.T','K'],['pressure','atmosphere.p','Pa'],['density_ratio','atmosphere.sigma','1'],['sound_speed','atmosphere.soundSpeed','m/s'],['model_speed_cap','atmosphere.Vcap','m/s'],
      ['K','model.K','1'],['A','model.A','N s2/m2'],['B','model.B','N m2/s2'],['stall_speed','summary.stallSpeed','m/s'],
      ['minimum_thrust','summary.minThrust.value','N'],['minimum_thrust_speed','summary.minThrust.speed','m/s'],['unrestricted_minimum_thrust','summary.minThrust.unrestrictedValue','N'],['unrestricted_minimum_thrust_speed','summary.minThrust.unrestrictedSpeed','m/s'],
      ['minimum_power','summary.minPower.value','W'],['minimum_power_speed','summary.minPower.speed','m/s'],['unrestricted_minimum_power','summary.minPower.unrestrictedValue','W'],['unrestricted_minimum_power_speed','summary.minPower.unrestrictedSpeed','m/s'],
      ['maximum_level_LD','summary.maxLevelLD.value','1'],['unrestricted_LD','summary.glide.unrestrictedLD','1'],['maximum_glide_LD','summary.glide.LD','1'],['glide_speed','summary.glide.speed','m/s'],['glide_angle','summary.glide.angleDeg','deg'],['glide_sink_rate','summary.glide.sink','m/s'],['glide_horizontal_speed','summary.glide.horizontalSpeed','m/s'],['glide_CL','summary.glide.CL','1'],['glide_CD','summary.glide.CD','1'],
      ['maximum_speed','summary.maxSpeed.value','m/s'],['best_climb_speed','summary.bestClimbSpeed','m/s'],['maximum_excess_power','summary.maxExcessPower.value','W'],['maximum_estimated_climb_rate','summary.maxRC','m/s'],['sustainable_lower_speed','summary.sustainable.lo','m/s'],['sustainable_upper_speed','summary.sustainable.hi','m/s']
    ];
    const rows=definitions.map(function(d){return {name:d[0],value:val(r,d[1]),unit:d[2]};});
    const units={V:'m/s',q:'Pa',CL:'1',CD:'1',D0:'N',Di:'N',TR:'N',PR:'W',TA:'N',PA:'W',excessThrust:'N',excessPower:'W',powerDeficit:'W',RC:'m/s',mach:'1',angleDeg:'deg'};
    Object.keys(units).forEach(function(k){rows.push({name:'operating_'+k,value:r.operating[k],unit:units[k]});});
    return rows;
  }
  function exportObject(r) {
    return {application:'AERO301 Aircraft Performance',applicationVersion:C.VERSION,specification:'Student 1 Theory and PRD v3.0',caseId:r.input.caseId,runTimestamp:r.runTimestamp,scope:'Development app run; not independent student validation.',inputUnits:{W:'N',m:'kg',S:'m2',b:'m',AR:'1',e:'1',CD0:'1',CLmax:'1',h:'geopotential m',supply:r.input.mode==='propeller'?'kW useful power':'N thrust',Vlo:'m/s TAS',Vhi:'m/s TAS',Vop:'m/s TAS'},internalPowerUnit:'W',constants:C.CONSTANTS,inputs:r.input,model:r.model,atmosphere:r.atmosphere,summary:r.summary,operatingPoint:r.operating,warnings:r.warnings,solver:r.solver,curves:r.curves};
  }
  function filename(s) { return String(s||'case').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100); }
  function download(name,text,type) {
    const url=URL.createObjectURL(new Blob([text],{type:type}));
    const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1500);
  }
  function csvCell(v) {
    if(v==null) return '';
    let s=typeof v==='object'?JSON.stringify(v):String(v);
    if(typeof v==='string' && /^[=+@]/.test(s)) s="'"+s;
    return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
  }
  function csv(rows) { return rows.map(function(row){return row.map(csvCell).join(',');}).join('\r\n'); }
  function runCsv(r) {
    const headers=['record_type','case_id','run_timestamp','name','value','unit','V_m_s','TR_N','TA_N','PR_W','PA_W','excess_thrust_N','excess_power_W','power_deficit_W','RC_m_s','Mach','supported_domain','level_feasible','flags'];
    const rows=[headers];
    const metadata={application_version:C.VERSION,specification:'Student 1 PRD v3.0',inputs:r.input,input_units:exportObject(r).inputUnits,constants:C.CONSTANTS,model:r.model,solver:r.solver,warnings:r.warnings,maximum_speed_status:r.summary.maxSpeed.status};
    Object.keys(metadata).forEach(function(k){rows.push(['metadata',r.input.caseId,r.runTimestamp,k,metadata[k]]);});
    scalarRows(r).forEach(function(s){rows.push(['summary',r.input.caseId,r.runTimestamp,s.name,s.value,s.unit]);});
    r.curves.forEach(function(p){rows.push(['curve',r.input.caseId,r.runTimestamp,'','','',p.V,p.TR,p.TA,p.PR,p.PA,p.excessThrust,p.excessPower,p.powerDeficit,p.RC,p.mach,p.usable,p.levelFeasible,p.flags]);});
    return csv(rows.map(function(row){while(row.length<headers.length)row.push('');return row;}));
  }
  function selectedStudies() { return Array.from(document.querySelectorAll('input[name="study-kind"]:checked')).map(function(x){return x.value;}); }
  function clearStudies() {
    state.studies=null;$('study-results').innerHTML='';
    $('export-studies-json').disabled=true;$('export-studies-csv').disabled=true;
  }
  function studyBaseValue(kind,b) { return ({weight:b.W,ar:b.AR,supply:b.supply,altitude:b.h,wingLoading:b.W/b.S,cd0:b.CD0})[kind]; }
  function renderStudyInputs() {
    const old={};document.querySelectorAll('[data-study-values]').forEach(function(el){old[el.dataset.studyValues]=el.value;});
    const b=state.baseline;
    $('study-inputs').innerHTML=selectedStudies().map(function(kind){
      const d=studyDefinitions[kind];let values='';
      if(b) {
        if(kind==='altitude') values=[0,2000,4000].join(', ');
        else values=d.factors.map(function(f){return Number((studyBaseValue(kind,b)*f).toPrecision(12));}).join(', ');
      }
      if(old[kind]!=null)values=old[kind];
      const unit=kind==='supply'?(b&&b.mode==='jet'?'N':'kW'):d.unit;
      return '<div class="study-values"><label for="study-'+kind+'">'+esc(d.label)+'<small>'+esc(unit)+'</small></label><div><input id="study-'+kind+'" data-study-values="'+kind+'" value="'+esc(values)+'" placeholder="Three values, separated by commas"><small class="muted">'+esc(d.control)+'</small></div></div>';
    }).join('');
    clearStudies();
  }
  function captureBaseline() {
    if(!state.last||state.dirty) { $('study-messages').innerHTML=message('error','Calculate the current inputs before capturing a baseline.');return; }
    state.baseline=clone(state.last.input);
    state.baseline.weightMode='weight';state.baseline.geometryMode='ar';
    $('baseline-label').textContent=state.baseline.caseId+' · '+state.baseline.mode+' · '+num(state.baseline.h,0)+' m';
    $('study-inputs').innerHTML='';renderStudyInputs();$('study-messages').innerHTML=message('info','Baseline captured.', ['Physical baseline values are fixed for these study runs. Weight and aspect ratio are used as the independent input forms.']);
  }
  function runStudies() {
    clearStudies();
    const kinds=selectedStudies(), b=state.baseline;
    if(kinds.length!==3) { $('study-messages').innerHTML=message('error','Select exactly three study categories.');return; }
    if(!b) { $('study-messages').innerHTML=message('error','Capture a calculated baseline first.');return; }
    const groups=[], errors=[];
    kinds.forEach(function(kind){
      const raw=$('study-'+kind).value.split(',').map(function(s){return s.trim();});
      const xs=raw.map(Number);
      if(raw.some(function(s){return !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s);})||xs.some(function(n){return !Number.isFinite(n);})||xs.length<3||new Set(xs).size!==xs.length) {
        errors.push(studyDefinitions[kind].label+': enter at least three distinct finite values separated by commas.');return;
      }
      const group={category:kind,label:studyDefinitions[kind].label,unit:kind==='supply'?(b.mode==='propeller'?'kW':'N'):studyDefinitions[kind].unit,baseline:clone(b),controlledParameters:studyDefinitions[kind].control,values:xs,runs:[]};
      xs.forEach(function(x,i){
        const input=clone(b);input.caseId=b.caseId+'_'+kind+'_'+(i+1);
        if(kind==='weight')input.W=x;
        else if(kind==='ar')input.AR=x;
        else if(kind==='supply')input.supply=x;
        else if(kind==='altitude')input.h=x;
        else if(kind==='wingLoading') { if(!(x>0)) { errors.push('Wing loading must be positive.');return; } input.S=b.W/x; }
        else if(kind==='cd0')input.CD0=x;
        const r=C.calculate(input);
        if(!r.ok) { errors.push(input.caseId+': '+r.errors.join(' '));return; }
        r.runTimestamp=new Date().toISOString();
        if(kind==='altitude'&&input.supplyMode==='altitude')r.warnings.push('Altitude study holds selected-altitude propulsion input fixed: this is a constant-supply comparison, not an engine lapse prediction.');
        group.runs.push({variedValue:x,result:r});
      });
      groups.push(group);
    });
    if(errors.length) { $('study-messages').innerHTML=message('error','Study batch not completed. Correct these values and run again.',errors);return; }
    state.studies={createdAt:new Date().toISOString(),baseline:clone(b),selectedCategories:kinds,groups:groups};
    groups.forEach(function(g){g.runs.forEach(function(run){state.history.push(run.result);});});renderHistory();
    $('study-messages').innerHTML=message('success','Recorded '+groups.reduce(function(n,g){return n+g.runs.length;},0)+' app runs across exactly three studies.', ['Each run preserves inputs, warnings and solver status. Export before closing the page.']);
    $('export-studies-json').disabled=false;$('export-studies-csv').disabled=false;
    $('study-results').innerHTML=groups.map(function(g,gi){
      return '<section class="surface"><p class="eyebrow">APP-GENERATED RESULTS</p><h2>'+esc(g.label)+'</h2><p class="small muted">'+esc(g.controlledParameters)+'</p><div class="table-scroll"><table><thead><tr><th>Value · '+esc(g.unit)+'</th><th>Stall · m/s</th><th>Vmax · m/s</th><th>Max RC estimate · m/s</th><th>Model notes</th><th></th></tr></thead><tbody>'+g.runs.map(function(run,ri){
        const r=run.result;return '<tr><td>'+esc(Number(run.variedValue.toPrecision(9)))+'</td><td>'+num(r.summary.stallSpeed,3)+'</td><td>'+num(r.summary.maxSpeed.value,3)+'</td><td>'+num(r.summary.maxRC,3)+'</td><td>'+r.warnings.length+' · '+esc(r.summary.maxSpeed.status)+'</td><td><button type="button" class="text-button" data-study-inspect="'+gi+','+ri+'">Inspect</button></td></tr>';
      }).join('')+'</tbody></table></div></section>';
    }).join('');
  }
  function studiesObject() {
    return {applicationVersion:C.VERSION,specification:'Student 1 PRD v3.0',createdAt:state.studies.createdAt,selectedCategories:state.studies.selectedCategories,baseline:state.studies.baseline,scope:'App-generated study runs; engineering interpretation is student work.',groups:state.studies.groups.map(function(g){return {category:g.category,label:g.label,unit:g.unit,baseline:g.baseline,controlledParameters:g.controlledParameters,values:g.values,runs:g.runs.map(function(run){return {variedValue:run.variedValue,run:exportObject(run.result)};})};})};
  }
  function studyCsv() {
    const rows=[['record_type','study','varied_value','varied_unit','case_id','run_timestamp','quantity','value','unit','inputs','warnings','solver']];
    rows.push(['metadata','','','','','','application_version',C.VERSION]);
    rows.push(['metadata','','','','','','constants',C.CONSTANTS]);
    rows.push(['metadata','','','','','','selected_categories',state.studies.selectedCategories]);
    rows.push(['metadata','','','','','','baseline',state.studies.baseline]);
    state.studies.groups.forEach(function(g){
      rows.push(['study_metadata',g.category,'',g.unit,'','','controlled_parameters',g.controlledParameters]);
      g.runs.forEach(function(run){
        const r=run.result;
        scalarRows(r).forEach(function(s,i){rows.push(['summary',g.category,run.variedValue,g.unit,r.input.caseId,r.runTimestamp,s.name,s.value,s.unit,i===0?r.input:'',i===0?r.warnings:'',i===0?r.solver:'']);});
      });
    });
    return csv(rows.map(function(row){while(row.length<12)row.push('');return row;}));
  }
  function referenceCheck() {
    const refs=[
      ['Density','atmosphere.rho','kg/m³',1.225000,1.225000,.000001,6],
      ['Stall TAS','summary.stallSpeed','m/s',27.822247,47.195798,.0001,6],
      ['Minimum thrust','summary.minThrust.value','N',936.742273,3133.324974,.01,6],
      ['Minimum-thrust TAS','summary.minThrust.speed','m/s',39.063694,70.623224,.0001,6],
      ['Minimum power','summary.minPower.value','W',32105.725247,194152.073243,.1,6],
      ['Minimum-power TAS','summary.minPower.speed','m/s',29.681989,53.662046,.0001,6],
      ['Maximum L/D','summary.glide.LD','1',12.108987,15.048232,.00001,6],
      ['Glide angle','summary.glide.angleDeg','deg',4.720961,3.801886,.001,6],
      ['Exact best-glide TAS','summary.glide.speed','m/s',38.997373,70.545470,.0001,6],
      ['Glide sink rate','summary.glide.sink','m/s',3.209605,4.677641,.001,6],
      ['Maximum speed','summary.maxSpeed.value','m/s',58.949450,97.319840,.0001,6],
      ['Best climb-rate TAS','summary.bestClimbSpeed','m/s',29.681989,74.374872,.0001,6],
      ['Maximum excess power','summary.maxExcessPower.value','W',42894.274753,48334.120211,.1,6],
      ['Maximum estimated RC','summary.maxRC','m/s',3.781563,1.025092,.001,6],
      ['Operating dynamic pressure','operating.q','Pa',980.000014,3920.000058,.1,6],
      ['Operating CL','operating.CL','1',.716022,.539459,.00001,6],
      ['Operating CD','operating.CD','1',.059198,.036969,.00001,6],
      ['Operating drag','operating.TR','N',937.793541,3231.226933,.01,6],
      ['Operating required power','operating.PR','W',37511.741621,258498.154669,.1,6],
      ['Operating available thrust','operating.TA','N',1875,3800,.01,6],
      ['Operating available power','operating.PA','W',75000,304000,.1,6],
      ['Operating excess thrust','operating.excessThrust','N',937.206459,568.773067,.01,6],
      ['Operating excess power','operating.excessPower','W',37488.258379,45501.845331,.1,6],
      ['Operating estimated RC','operating.RC','m/s',3.304969,.965024,.001,6],
      ['Operating power deficit','operating.powerDeficit','W',0,0,.1,6]
    ];
    let total=0, passed=0, html='';
    ['V01','V02'].forEach(function(id,caseIndex){
      const r=C.calculate(C.PRESETS[id]);
      html+='<h3>'+id+' · supplied Part C targets</h3><div class="table-scroll"><table><thead><tr><th>Quantity</th><th class="numeric">Reference</th><th class="numeric">App</th><th class="numeric">Absolute error</th><th>Check</th></tr></thead><tbody>';
      refs.forEach(function(ref){
        const x=val(r,ref[1]),expected=ref[3+caseIndex],error=Math.abs(x-expected),pass=Number.isFinite(x)&&error<=ref[5]+.001*Math.abs(expected);
        total++;if(pass)passed++;
        html+='<tr><td>'+esc(ref[0])+' <span class="muted">'+esc(ref[2])+'</span></td><td class="numeric">'+num(expected,ref[6])+'</td><td class="numeric">'+num(x,ref[6])+'</td><td class="numeric">'+error.toExponential(3)+'</td><td class="'+(pass?'pass':'fail')+'">'+(pass?'Pass':'Fail')+'</td></tr>';
      });
      html+='</tbody></table></div>';
    });
    $('reference-results').innerHTML=message(passed===total?'success':'error',passed+' of '+total+' numerical reference comparisons pass.', ['These compare software arithmetic with the supplied targets; they are not independent physical or handwritten validation.'])+html;
  }
  $('aircraft-form').addEventListener('submit',function(e){e.preventDefault();calculate();});
  $('aircraft-form').addEventListener('input',dirty);
  $('aircraft-form').addEventListener('change',dirty);
  $('reset').addEventListener('click',function(){preset($('mode').value==='jet'?'V02':'V01',false);});
  $('first-check').addEventListener('click',function(){preset('V01',true);selectTab('overview');});
  document.querySelectorAll('[data-preset]').forEach(function(b){b.addEventListener('click',function(){preset(b.dataset.preset,false);});});
  document.querySelectorAll('[data-tab]').forEach(function(b){b.addEventListener('click',function(){selectTab(b.dataset.tab);});});
  document.querySelector('.tabs').addEventListener('keydown',function(e){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=Array.from(document.querySelectorAll('[data-tab]'));let i=tabs.indexOf(document.activeElement);if(i<0)return;e.preventDefault();i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;selectTab(tabs[i].dataset.tab);tabs[i].focus();});
  document.querySelectorAll('[data-plot]').forEach(function(b){b.addEventListener('click',function(){state.plot=b.dataset.plot;document.querySelectorAll('[data-plot]').forEach(function(x){x.classList.toggle('active',x===b);});renderPlot();});});
  $('history').addEventListener('click',function(e){const b=e.target.closest('[data-history]');if(!b)return;const r=state.history[Number(b.dataset.history)];setInputs(r.input);showResult(r);selectTab('overview');});
  $('export-json').addEventListener('click',function(){if(!state.last||state.dirty)return;download(filename(state.last.input.caseId)+'_run.json',JSON.stringify(exportObject(state.last),null,2),'application/json');});
  $('export-csv').addEventListener('click',function(){if(!state.last||state.dirty)return;download(filename(state.last.input.caseId)+'_results_curves.csv',runCsv(state.last),'text/csv;charset=utf-8');});
  $('export-svg').addEventListener('click',function(){if(!state.last||state.dirty)return;download(filename(state.last.input.caseId)+'_'+state.plot+'.svg',state.svg,'image/svg+xml');});
  document.querySelectorAll('input[name="study-kind"]').forEach(function(el){el.addEventListener('change',renderStudyInputs);});
  $('study-inputs').addEventListener('input',function(){clearStudies();$('study-messages').innerHTML=message('info','Study values changed. Run the studies again before exporting.');});
  $('capture-baseline').addEventListener('click',captureBaseline);
  $('run-studies').addEventListener('click',runStudies);
  $('study-results').addEventListener('click',function(e){const b=e.target.closest('[data-study-inspect]');if(!b||!state.studies)return;const ix=b.dataset.studyInspect.split(',').map(Number);const r=state.studies.groups[ix[0]].runs[ix[1]].result;setInputs(r.input);showResult(r);selectTab('curves');});
  $('export-studies-json').addEventListener('click',function(){if(state.studies)download(filename(state.studies.baseline.caseId)+'_three_studies.json',JSON.stringify(studiesObject(),null,2),'application/json');});
  $('export-studies-csv').addEventListener('click',function(){if(state.studies)download(filename(state.studies.baseline.caseId)+'_three_studies.csv',studyCsv(),'text/csv;charset=utf-8');});
  $('reference-check').addEventListener('click',referenceCheck);
  $('power').value=C.PRESETS.V01.supply;$('thrust').value=C.PRESETS.V02.supply;
  preset('V01',true);renderStudyInputs();selectTab('overview');
})();
