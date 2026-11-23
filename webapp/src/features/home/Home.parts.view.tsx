import { homeRequests, type HomeModel } from './Home.model';
import { homeCopy as copy } from './Home.copy';
import { reviewHref } from '../reviews/navigation';
import { LoadingIndicator } from '../../views/LoadingIndicator.view';
import { ReviewQueueFilterView } from '../reviews/ReviewQueueFilter.view';

export function HomeHeader({ state, actions }: HomeModel) {
  return <header className="home-heading"><h1>{copy.title.text}</h1><button disabled={state.busy} onClick={actions.reconnect}>{copy.reconnect.text}</button></header>;
}
export function HomeSources({ state, actions, connectionId, repository }: HomeModel) {
  return <section aria-label={copy.sources.text} className="home-sources"><h2>{copy.sources.text}</h2>
    {state.busy && <LoadingIndicator compact label={copy.loading.text} />}
    {state.error && <p role="alert">{state.error}</p>}
    {!state.supported && <p role="alert">{copy.unsupported.text}</p>}
    {!state.busy && !state.error && !state.connections.length && <p>{copy.noConnections.text}</p>}
    {!state.canEnumerate && state.supported && state.connections.length > 0 && <form onSubmit={event => { event.preventDefault(); actions.addRepository(); }}>
      <p>{copy.manual.text}</p>
      <label>{copy.connection.text}<select value={connectionId || state.connections[0]?.id} onChange={event => actions.setConnectionId(event.target.value)}>{state.connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}{copy.separator.text}{connection.account}</option>)}</select></label>
      <label>{copy.repository.text}<input placeholder={copy.example.text} value={repository} onChange={event => actions.setRepository(event.target.value)} required pattern="[^/\s]+/[^/\s]+" /></label>
      <button>{copy.add.text}</button>
    </form>}
    <ul>{state.sources.map(source => <li key={source.id} data-source-kind={source.kind}>
      <strong>{source.connection.name}{copy.separator.text}{source.connection.account}</strong>
      {source.repository && <div>{source.repository}</div>}{source.scope && <div>{source.scope.workspace}</div>}
      {source.busy ? <LoadingIndicator compact label={copy.loading.text} /> : source.error ? <><p role="alert">{source.error}</p><button onClick={() => actions.retry(source.id)}>{copy.retry.text}</button></> : <span>{copy.ready.text}</span>}
    </li>)}</ul>
    {!state.busy && !state.error && state.supported && state.connections.length > 0 && state.canEnumerate && state.sources.length > 0 && state.sources.every(source => !source.busy && !source.error && source.kind !== 'workspace') && <p>{copy.noSources.text}</p>}
  </section>;
}
export function HomeRequests({ state, actions, queueFilter }: HomeModel) {
  const requests = homeRequests(state)
    .filter(({ category }) => queueFilter === 'all' || category === queueFilter);
  const loading = state.busy || state.sources.some(source => source.busy);
  if (loading && !state.sources.some(source => source.listing)) return <section aria-label={copy.requests.text} className="home-requests"><LoadingIndicator label={copy.loading.text} /></section>;
  return <section aria-label={copy.requests.text} className="home-requests"><h2>{copy.requests.text}</h2>
    <ReviewQueueFilterView value={queueFilter} onChange={actions.setQueueFilter} />
    <p>{copy.order.text}</p>{state.categoryError && <p role="alert">{state.categoryError}</p>}
    {loading && <LoadingIndicator compact label={copy.loading.text} />}
    {!requests.length && !loading && <p role="status">{copy.empty.text}</p>}
    <ul>{requests.map(({ source, review, status, key, category }) => <li key={key}>
      <h3><a href={reviewHref(source.scope!, review)}>{review.request.title}</a></h3>
      <p>{source.connection.name}{copy.separator.text}{source.repository}{copy.separator.text}{source.scope!.workspace}</p>
      <p>{review.request.purpose}</p><span>{status}</span>
      <p>{review.request.created_at ? <time dateTime={review.request.created_at}>{review.request.created_at}</time> : copy.unknownDate.text}</p>
      {category === 'dismissed' && <span>{copy.dismissed.text}</span>}
      <button disabled={state.categorizing.includes(JSON.stringify([source.id, review.request.request_id]))} onClick={() => actions.categorize(source.id, review.request.request_id, category === 'dismissed' ? 'active' : 'dismissed')}>{category === 'dismissed' ? copy.restore.text : copy.dismiss.text}</button>
    </li>)}</ul>
  </section>;
}
