package com.scmv.android;

import com.scmv.android.data.session.SessionManager;
import com.scmv.android.data.settings.AppSettings;
import dagger.MembersInjector;
import dagger.internal.DaggerGenerated;
import dagger.internal.InjectedFieldSignature;
import dagger.internal.QualifierMetadata;
import javax.annotation.processing.Generated;
import javax.inject.Provider;

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
public final class MainActivity_MembersInjector implements MembersInjector<MainActivity> {
  private final Provider<SessionManager> sessionManagerProvider;

  private final Provider<AppSettings> appSettingsProvider;

  public MainActivity_MembersInjector(Provider<SessionManager> sessionManagerProvider,
      Provider<AppSettings> appSettingsProvider) {
    this.sessionManagerProvider = sessionManagerProvider;
    this.appSettingsProvider = appSettingsProvider;
  }

  public static MembersInjector<MainActivity> create(
      Provider<SessionManager> sessionManagerProvider, Provider<AppSettings> appSettingsProvider) {
    return new MainActivity_MembersInjector(sessionManagerProvider, appSettingsProvider);
  }

  @Override
  public void injectMembers(MainActivity instance) {
    injectSessionManager(instance, sessionManagerProvider.get());
    injectAppSettings(instance, appSettingsProvider.get());
  }

  @InjectedFieldSignature("com.scmv.android.MainActivity.sessionManager")
  public static void injectSessionManager(MainActivity instance, SessionManager sessionManager) {
    instance.sessionManager = sessionManager;
  }

  @InjectedFieldSignature("com.scmv.android.MainActivity.appSettings")
  public static void injectAppSettings(MainActivity instance, AppSettings appSettings) {
    instance.appSettings = appSettings;
  }
}
