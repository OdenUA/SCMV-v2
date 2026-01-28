package com.scmv.android.ui.screen.login;

import com.scmv.android.data.remote.WsClient;
import com.scmv.android.data.repository.AuthRepository;
import com.scmv.android.data.session.SessionManager;
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
public final class LoginViewModel_Factory implements Factory<LoginViewModel> {
  private final Provider<AuthRepository> authRepositoryProvider;

  private final Provider<SessionManager> sessionManagerProvider;

  private final Provider<WsClient> wsClientProvider;

  public LoginViewModel_Factory(Provider<AuthRepository> authRepositoryProvider,
      Provider<SessionManager> sessionManagerProvider, Provider<WsClient> wsClientProvider) {
    this.authRepositoryProvider = authRepositoryProvider;
    this.sessionManagerProvider = sessionManagerProvider;
    this.wsClientProvider = wsClientProvider;
  }

  @Override
  public LoginViewModel get() {
    return newInstance(authRepositoryProvider.get(), sessionManagerProvider.get(), wsClientProvider.get());
  }

  public static LoginViewModel_Factory create(Provider<AuthRepository> authRepositoryProvider,
      Provider<SessionManager> sessionManagerProvider, Provider<WsClient> wsClientProvider) {
    return new LoginViewModel_Factory(authRepositoryProvider, sessionManagerProvider, wsClientProvider);
  }

  public static LoginViewModel newInstance(AuthRepository authRepository,
      SessionManager sessionManager, WsClient wsClient) {
    return new LoginViewModel(authRepository, sessionManager, wsClient);
  }
}
