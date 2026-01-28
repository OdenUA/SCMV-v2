package com.scmv.android.data.settings;

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
public final class AppSettings_Factory implements Factory<AppSettings> {
  private final Provider<DataStore<Preferences>> dataStoreProvider;

  public AppSettings_Factory(Provider<DataStore<Preferences>> dataStoreProvider) {
    this.dataStoreProvider = dataStoreProvider;
  }

  @Override
  public AppSettings get() {
    return newInstance(dataStoreProvider.get());
  }

  public static AppSettings_Factory create(Provider<DataStore<Preferences>> dataStoreProvider) {
    return new AppSettings_Factory(dataStoreProvider);
  }

  public static AppSettings newInstance(DataStore<Preferences> dataStore) {
    return new AppSettings(dataStore);
  }
}
