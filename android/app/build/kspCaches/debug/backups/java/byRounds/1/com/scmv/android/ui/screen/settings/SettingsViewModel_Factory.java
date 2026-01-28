package com.scmv.android.ui.screen.settings;

import com.scmv.android.data.remote.WsClient;
import com.scmv.android.data.session.SessionManager;
import com.scmv.android.data.settings.AppSettings;
import dagger.internal.DaggerGenerated;
import dagger.internal.Factory;
import dagger.internal.QualifierMetadata;
import dagger.internal.ScopeMetadata;
import javax.annotation.processing.Generated;
import javax.inject.Provider;

@ScopeMetadata
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
public final class SettingsViewModel_Factory implements Factory<SettingsViewModel> {
  private final Provider<WsClient> wsClientProvider;

  private final Provider<SessionManager> sessionManagerProvider;

  private final Provider<AppSettings> appSettingsProvider;

  public SettingsViewModel_Factory(Provider<WsClient> wsClientProvider,
      Provider<SessionManager> sessionManagerProvider, Provider<AppSettings> appSettingsProvider) {
    this.wsClientProvider = wsClientProvider;
    this.sessionManagerProvider = sessionManagerProvider;
    this.appSettingsProvider = appSettingsProvider;
  }

  @Override
  public SettingsViewModel get() {
    return newInstance(wsClientProvider.get(), sessionManagerProvider.get(), appSettingsProvider.get());
  }

  public static SettingsViewModel_Factory create(Provider<WsClient> wsClientProvider,
      Provider<SessionManager> sessionManagerProvider, Provider<AppSettings> appSettingsProvider) {
    return new SettingsViewModel_Factory(wsClientProvider, sessionManagerProvider, appSettingsProvider);
  }

  public static SettingsViewModel newInstance(WsClient wsClient, SessionManager sessionManager,
      AppSettings appSettings) {
    return new SettingsViewModel(wsClient, sessionManager, appSettings);
  }
}
