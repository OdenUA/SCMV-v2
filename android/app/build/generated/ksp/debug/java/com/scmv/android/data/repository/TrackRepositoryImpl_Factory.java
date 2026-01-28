package com.scmv.android.data.repository;

import com.scmv.android.data.remote.WsClient;
import com.scmv.android.data.session.SessionManager;
import dagger.internal.DaggerGenerated;
import dagger.internal.Factory;
import dagger.internal.QualifierMetadata;
import dagger.internal.ScopeMetadata;
import javax.annotation.processing.Generated;
import javax.inject.Provider;
import kotlinx.serialization.json.Json;

@ScopeMetadata("javax.inject.Singleton")
@QualifierMetadata
@DaggerGenerated
@Generated(
    value = "dagger.internal.codegen.ComponentProcessor",
    comments = "https://dagger.dev"
)
@SuppressWarnings({
    "unchecked",
    "rawtypes",
    "KotlinInternal",
    "KotlinInternalInJava"
})
public final class TrackRepositoryImpl_Factory implements Factory<TrackRepositoryImpl> {
  private final Provider<WsClient> wsClientProvider;

  private final Provider<SessionManager> sessionManagerProvider;

  private final Provider<Json> jsonProvider;

  public TrackRepositoryImpl_Factory(Provider<WsClient> wsClientProvider,
      Provider<SessionManager> sessionManagerProvider, Provider<Json> jsonProvider) {
    this.wsClientProvider = wsClientProvider;
    this.sessionManagerProvider = sessionManagerProvider;
    this.jsonProvider = jsonProvider;
  }

  @Override
  public TrackRepositoryImpl get() {
    return newInstance(wsClientProvider.get(), sessionManagerProvider.get(), jsonProvider.get());
  }

  public static TrackRepositoryImpl_Factory create(Provider<WsClient> wsClientProvider,
      Provider<SessionManager> sessionManagerProvider, Provider<Json> jsonProvider) {
    return new TrackRepositoryImpl_Factory(wsClientProvider, sessionManagerProvider, jsonProvider);
  }

  public static TrackRepositoryImpl newInstance(WsClient wsClient, SessionManager sessionManager,
      Json json) {
    return new TrackRepositoryImpl(wsClient, sessionManager, json);
  }
}
