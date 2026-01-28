package com.scmv.android.data.session;

import androidx.datastore.core.DataStore;
import androidx.datastore.preferences.core.Preferences;
import dagger.internal.DaggerGenerated;
import dagger.internal.Factory;
import dagger.internal.QualifierMetadata;
import dagger.internal.ScopeMetadata;
import javax.annotation.processing.Generated;
import javax.inject.Provider;

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
public final class SessionManager_Factory implements Factory<SessionManager> {
  private final Provider<DataStore<Preferences>> dataStoreProvider;

  public SessionManager_Factory(Provider<DataStore<Preferences>> dataStoreProvider) {
    this.dataStoreProvider = dataStoreProvider;
  }

  @Override
  public SessionManager get() {
    return newInstance(dataStoreProvider.get());
  }

  public static SessionManager_Factory create(Provider<DataStore<Preferences>> dataStoreProvider) {
    return new SessionManager_Factory(dataStoreProvider);
  }

  public static SessionManager newInstance(DataStore<Preferences> dataStore) {
    return new SessionManager(dataStore);
  }
}
